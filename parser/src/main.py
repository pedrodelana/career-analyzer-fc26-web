"""Read-only bridge to the pinned upstream binary decoder.

All outputs and generated game data stay inside this project. No game/save
editing entry points from the upstream project are invoked.
"""
import argparse
import contextlib
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).resolve().parent))
from normalize import normalize
from club_names import resolve_club_name
from career_dates import career_date_info

UPSTREAM=Path(os.environ.get('FC26_PARSER_DIR',str(ROOT/'.tools/fc26-save-parser')))
sys.path.insert(0,str(UPSTREAM/'src'))

def read_map(path):
    if not path.exists():
        return {}
    data=json.loads(path.read_text(encoding='utf-8-sig'))
    if not isinstance(data,dict) or any(not isinstance(v,str) for v in data.values()):
        raise ValueError('Invalid local names dictionary')
    return data

class Tables:
    def __init__(self,path):
        import fc26_db_decoder as decoder
        self.decoder=decoder
        with path.open('rb') as stream:
            self.data=stream.read()
        if not self.data.startswith(b'FBCHUNKS'):
            raise ValueError('Unsupported save container')
        self.tables=defaultdict(list)
        for index,offset in enumerate(decoder.find_db_signatures(self.data)):
            if offset+24>len(self.data):
                continue
            db=decoder.parse_database(self.data,index,offset)
            if not 0<db.table_count<4096 or db.tables_start>len(self.data):
                continue
            for table in decoder.parse_table_directory(self.data,db):
                h=table.abs_header_offset
                if h<0 or h+36>len(self.data):
                    continue
                if h+36+self.data[h+24]*16>len(self.data):
                    continue
                decoder.parse_table_header(self.data,table)
                if decoder.sanity_check_table(table,len(self.data)) and all(f.bit_offset+f.bit_depth<=table.record_size*8 for f in table.fields):
                    self.tables[table.shortname].append((index,table))
        if not all(key in self.tables for key in ['mPrV','RrqT','lyxL','CZUM']):
            raise ValueError('Required FC26 tables were not found')

    def rows(self,name):
        result=[]
        for db,table in self.tables.get(name,[]):
            rows=self.decoder.decode_table_records(self.data,table)
            for index,row in enumerate(rows):
                result.append({**row,'_recordKey':f'{db}:{name}:{table.index}:{index}'})
        return result

def context(tables):
    links=tables.rows('RrqT')
    teams=defaultdict(list)
    for row in tables.rows('lyxL'):
        teams[row.get('mCXg')].append(row)
    contracts=tables.rows('DvsP')
    prospects=tables.rows('IOmq')
    # Club detection needs agreement of two independent career relations.
    # No manager-name or club-name grouping, and no majority-vote fallback.
    youth_teams={tid for tid,rows in teams.items() if len(rows)==1 and str(rows[0].get('AUsv','')).startswith('Youth Squad')}
    contract_teams={r.get('mCXg') for r in contracts}-youth_teams-{None}
    hints={r.get('ykFq') for r in tables.rows('TcEm')}
    linked_hints={r.get('mCXg') for r in links if r.get('ykFq') in hints}-youth_teams
    club_id=next(iter(contract_teams)) if len(contract_teams)==1 else None
    corroborating_links=[link for link in links if link.get('mCXg')==club_id and any(c.get('mCXg')==club_id and c.get('ykFq')==link.get('ykFq') for c in contracts)]
    if not corroborating_links or (hints and club_id not in linked_hints):
        club_id=None
    if club_id is None or len(teams.get(club_id,[]))!=1:
        club_id=None
    club_name,name_source,name_evidence,name_method=resolve_club_name(teams[club_id][0] if club_id is not None else None,tables.rows('mPrV'),getattr(tables,'data',b''))
    warnings=['Persistent career identity is not decoded. This save is kept as a separate entry.','Appearances, minutes and ratings summarize only recorded match-history rows; they are not guaranteed full-season totals.']
    if name_source=='UNRESOLVED':
        warnings.append('Enter the club name in Career settings; the save does not provide a verified display name.')
    if not (ROOT/'data/global_names.json').exists():
        warnings.append('Global names database is missing. Generate it in Settings to resolve player names.')
    metadata=dict(clubId=club_id,clubName=club_name,clubNameSource=name_source,clubNameEvidence=name_evidence,clubNameMethod=name_method,inGameDate=None,careerIdentifier=None,identityStatus='UNCONFIRMED' if club_id is not None else 'ERROR',evidence=['Unique senior club in the user-contract table DvsP, corroborated by RrqT roster membership and TcEm when present.'] if club_id is not None else [],warnings=warnings)
    return metadata,links,contracts,prospects,youth_teams

def parse(path,metadata_only=False):
    tables=Tables(path)
    metadata,links,contracts,prospects,youth_teams=context(tables)
    if metadata_only:
        return metadata
    if metadata['clubId'] is None:
        raise ValueError('CLUB_NOT_RESOLVED: The controlled club could not be established from independent save relations.')
    members=[]
    for row in links:
        if row.get('mCXg')==metadata['clubId']:
            members.append(dict(playerId=row['ykFq'],squadType='FIRST_TEAM',teamId=metadata['clubId']))
    # IOmq is the expected academy roster. Unlinked prospects are retained as
    # unresolved entries instead of disappearing from the integrity counts.
    extra=[]
    for row in prospects:
        pid=row.get('ykFq')
        matching=[r for r in links if r.get('ykFq')==pid and r.get('mCXg') in youth_teams]
        if len(matching)==1:
            members.append(dict(playerId=pid,squadType='YOUTH',teamId=matching[0]['mCXg']))
        else:
            extra.append(dict(code='PLAYER_RECORD_UNRESOLVED',message=f'Academy player {pid}: no unique youth membership.',playerId=pid,squadType='YOUTH'))
    history=tables.rows('TtHG')
    dates=career_date_info(tables.data,metadata['clubId'],history,links)
    if not dates['referenceDate']:
        metadata['warnings'].append('Age reference date unavailable: no verified completed match was found in this save.')
    result=normalize(tables.rows('CZUM'),members,contracts,read_map(ROOT/'data/global_names.json'),read_map(UPSTREAM/'data/nations.json'),metadata,game_date=dates['referenceDate'],matches=history)
    result['careerDateInfo']=dates
    result['issues'].extend(extra)
    result['integrity']['youthExpected']+=len(extra)
    result['integrity']['unresolvedCount']+=len(extra)
    return result

def generate_names(game_dir):
    import game_data
    game_data.GLOBAL_NAMES_PATH=ROOT/'data/global_names.json'
    game_data.GLOBAL_TEAMS_PATH=ROOT/'data/global_teams.json'
    game_data.GAME_DB_DIR=ROOT/'data/game_db'
    with contextlib.redirect_stdout(sys.stderr):
        game_data.ensure_game_data(game_dir=game_dir or None,progress=lambda message:print(message,file=sys.stderr))
    return {'ok':True}

def convert_image(source,target):
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS=16000000
    with Image.open(source) as picture:
        if picture.format not in ['DDS','PNG','JPEG','WEBP']:
            raise ValueError('Unsupported image format')
        picture=ImageOps.exif_transpose(picture).convert('RGBA')
        picture.thumbnail((512,512))
        picture.save(target,format='WEBP',quality=90)
        picture.save(str(Path(target).with_suffix('.png')),format='PNG')
    return {'ok':True}

def main():
    cli=argparse.ArgumentParser()
    cli.add_argument('action',choices=['metadata','parse','names','image','doctor'])
    cli.add_argument('--input')
    cli.add_argument('--output')
    args=cli.parse_args()
    if args.action=='doctor':
        import importlib.util
        result={'python':True,'pillow':importlib.util.find_spec('PIL') is not None,'parser':(UPSTREAM/'src/fc26_db_decoder.py').is_file()}
    elif args.action=='names':
        result=generate_names(args.input)
    elif args.action=='image':
        target=Path(args.output).resolve()
        if not target.is_relative_to(ROOT/'storage'):
            raise ValueError('Image output must stay in project storage')
        result=convert_image(args.input,target)
    else:
        path=Path(args.input)
        if not path.name.lower().startswith('cmmgr') or not path.is_file() or path.is_symlink():
            raise ValueError('Invalid Manager Career save')
        result=parse(path,args.action=='metadata')
    print(json.dumps(result,ensure_ascii=True,allow_nan=False))

if __name__=='__main__':
    try:
        main()
    except Exception as error:
        print(f'{type(error).__name__}: {error}',file=sys.stderr)
        print(json.dumps({'error':{'code':'SAVE_PARSE_ERROR','message':'The local parser could not complete this operation. Check diagnostics and local logs.'}}))
        sys.exit(1)
