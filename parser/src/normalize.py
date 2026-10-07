"""Conservative normalization. Raw player IDs never identify a record alone."""
import hashlib
import json
from collections import defaultdict
from datetime import date, timedelta
from ratings import RATING_FIELDS, NORMALIZATION_VERSION, normalize_ratings, display_rating

POSITIONS = {0:'GOL',1:'ZAG',2:'LD',3:'LD',4:'ZAG',5:'ZAG',6:'ZAG',7:'LE',8:'LE',9:'VOL',10:'VOL',11:'VOL',12:'MD',13:'MC',14:'MC',15:'MC',16:'ME',17:'MEI',18:'MEI',19:'MEI',20:'ATA',21:'ATA',22:'ATA',23:'PD',24:'ATA',25:'ATA',26:'ATA',27:'PE'}

def number(value, low=0, high=1000000000):
    return value if isinstance(value,(int,float)) and not isinstance(value,bool) and low <= value <= high else None

def birthday(raw):
    try:
        result=date(1582,10,14)+timedelta(days=raw)
        return result.isoformat() if 1900 <= result.year <= 2200 else None
    except (TypeError,OverflowError):
        return None

def name_for(row,names):
    common=names.get(str(row.get('Vqpv')),'').strip()
    full=' '.join(names.get(str(row.get(k)),'').strip() for k in ['tHlO','QCfa']).strip()
    return common or full or f"Unknown Player {row.get('ykFq')}"

def record_identity(row):
    # Identity-bearing fields only: attributes and squad membership can evolve.
    fields={k:row.get(k) for k in ['ykFq','tHlO','QCfa','Vqpv','WVIU','enmm']}
    return hashlib.sha256(json.dumps(fields,sort_keys=True).encode()).hexdigest()[:32]

def match_stats(pid,matches):
    rows=[r for r in matches if r.get('ykFq')==pid]
    if not rows:
        return None,None,None
    event_keys=[(r.get('JMld'),r.get('HBfc')) for r in rows]
    if any(None in key for key in event_keys) or len(set(event_keys))!=len(event_keys):
        return None,None,None
    minutes=[number(r.get('Amxm'),1,181) for r in rows]
    ratings=[number(r.get('Xxmh'),1,11) for r in rows]
    if any(v is None for v in minutes):
        return None,None,None
    played=[(m-1,r-1 if r is not None else None) for m,r in zip(minutes,ratings) if m>1]
    valid_ratings=[r for _,r in played if r is not None]
    return len(played),sum(m for m,_ in played),round(sum(valid_ratings)/len(valid_ratings),2) if valid_ratings else None

def normalize(records, memberships, contracts, names, nations, metadata, game_date=None,matches=None):
    by_id=defaultdict(list)
    for row in records:
        by_id[row.get('ykFq')].append(row)
    players,issues,decisions=[],[],[]
    integrity=dict(firstTeamExpected=0,firstTeamResolved=0,youthExpected=0,youthResolved=0,ambiguousCount=0,unresolvedCount=0)
    membership_counts=defaultdict(int)
    for member in memberships:
        membership_counts[member['playerId']]+=1
    for member in memberships:
        pid,squad=member['playerId'],member['squadType']
        prefix='firstTeam' if squad=='FIRST_TEAM' else 'youth'
        integrity[prefix+'Expected']+=1
        candidates=by_id.get(pid,[])
        # A verified record reference is supported; a player-id-only link cannot
        # disambiguate two raw records. Never use age/rating as a silent guess.
        if member.get('recordKey'):
            candidates=[r for r in candidates if r.get('_recordKey')==member['recordKey']]
        if len(candidates)!=1 or membership_counts[pid]>1:
            ambiguous=bool(candidates)
            integrity['ambiguousCount' if ambiguous else 'unresolvedCount']+=1
            options=[]
            for r in candidates:
                option=dict(recordKey=r['_recordKey'],displayName=name_for(r,names),birthDate=birthday(r.get('WVIU')),overall=display_rating(r.get('UERs')))
                # Offer a record preview only when the roster membership itself
                # is unique. Reuse normalization with one row, without ID-only
                # contracts/history, which cannot identify the chosen record.
                if membership_counts[pid]==1:
                    preview=normalize([r],[member],[],names,nations,metadata,game_date)['players']
                    if preview:
                        option['player']={**preview[0],'imageEligible':False}
                options.append(option)
            issues.append(dict(code='PLAYER_RECORD_AMBIGUOUS' if ambiguous else 'PLAYER_RECORD_UNRESOLVED',playerId=pid,squadType=squad,message=f"Player {pid}: {len(candidates)} candidate records; active record could not be established.",candidates=options))
            continue
        row=candidates[0]
        born=birthday(row.get('WVIU'))
        age=None
        if born and game_date:
            try:
                b,d=date.fromisoformat(born),date.fromisoformat(game_date)
                age=number(d.year-b.year-((d.month,d.day)<(b.month,b.day)),0,100)
            except (ValueError,TypeError):
                age=None
        ratings=normalize_ratings(dict(overall=row.get('UERs'),potential=row.get('mpuH'),attributes={label:row.get(code) for code,label in RATING_FIELDS.items() if code in row}))
        ovr,pot=ratings['overall'],ratings['potential']
        wages=[r.get('cmGX') for r in contracts if r.get('ykFq')==pid and r.get('mCXg')==member['teamId']]
        wage=number(wages[0]) if len(wages)==1 else None
        secondary=[]
        for key in ['NgVS','OblE','YnYz']:
            raw=row.get(key)
            pos=POSITIONS.get(raw-1) if isinstance(raw,int) and raw>0 else None
            if pos and pos not in secondary and pos!=POSITIONS.get(row.get('wZQU')):
                secondary.append(pos)
        players.append(dict(internalKey=record_identity(row),playerId=pid,displayName=name_for(row,names),squadType=squad,age=age,birthDate=born,primaryPosition=POSITIONS.get(row.get('wZQU')),secondaryPositions=secondary,overall=ovr,potential=pot,growthMargin=pot-ovr if pot is not None and ovr is not None else None,contractEndYear=number(row.get('qvmK'),1900,2200) if squad=='FIRST_TEAM' else None,weeklyWage=wage,appearances=None,minutes=None,averageRating=None,nationality=nations.get(str(row.get('enmm'))),imageEligible=len(by_id[pid])==1))
        players[-1].update(ratings)
        if matches is not None and len(by_id[pid])==1:
            appearances,minutes,rating=match_stats(pid,matches)
            players[-1].update(appearances=appearances,minutes=minutes,averageRating=rating)
        integrity[prefix+'Resolved']+=1
        decisions.append(dict(playerId=pid,reason=f"Unique raw record {row['_recordKey']}; explicit {squad} membership in team {member['teamId']}."))
    return dict(normalizationVersion=NORMALIZATION_VERSION,metadata=metadata,players=players,integrity=integrity,issues=issues,decisions=decisions)
