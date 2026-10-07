import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from normalize import normalize,match_stats

def record(key='record-a',**changes):
    return {'_recordKey':key,'ykFq':7,'tHlO':1,'QCfa':2,'Vqpv':3,'UERs':70,'mpuH':82,'wZQU':14,'qvmK':2030,'WVIU':154573,**changes}

def member(squad='FIRST_TEAM',**changes):
    return dict(playerId=7,squadType=squad,teamId=1,**changes)

class NormalizationTest(unittest.TestCase):
    def parse(self,rows,members=None,names=None):
        return normalize(rows,members or [member()],[],names or {},{}, {})

    def test_duplicate_id_never_chooses_first_or_last(self):
        result=self.parse([record(),record('record-b',UERs=90)])
        self.assertEqual(result['players'],[])
        self.assertEqual(result['integrity']['firstTeamExpected'],1)
        self.assertEqual(result['integrity']['ambiguousCount'],1)
        self.assertEqual(len(result['issues'][0]['candidates']),2)

    def test_verified_record_reference_disambiguates(self):
        result=self.parse([record(),record('record-b',UERs=90)],[member(recordKey='record-b')])
        self.assertEqual(result['players'][0]['overall'],91)
        self.assertFalse(result['players'][0]['imageEligible'])

    def test_candidates_include_normalized_previews_without_id_only_data(self):
        result=normalize([record(),record('record-b',Vqpv=4,UERs=48)],
            [member('YOUTH')],[dict(ykFq=7,mCXg=1,cmGX=900)],
            {'3':'Costa','4':'Young'},{},{},
            matches=[dict(ykFq=7,JMld=1,HBfc=180109,Amxm=91,Xxmh=10)])
        young=result['issues'][0]['candidates'][1]['player']
        self.assertEqual(young['displayName'],'Young')
        self.assertEqual(young['overall'],49)
        self.assertEqual(young['squadType'],'YOUTH')
        for key in ['weeklyWage','appearances','minutes','averageRating','contractEndYear']:
            self.assertIsNone(young[key])
        self.assertFalse(young['imageEligible'])
        self.assertEqual(result['players'],[])

    def test_record_reference_does_not_disambiguate_id_only_history(self):
        result=normalize([record(),record('record-b',Vqpv=4)],
            [member(recordKey='record-b')],[],{},{},{},
            matches=[dict(ykFq=7,JMld=1,HBfc=180109,Amxm=91,Xxmh=10)])
        self.assertIsNone(result['players'][0]['appearances'])

    def test_missing_record_retains_integrity(self):
        result=self.parse([],[member('YOUTH')])
        self.assertEqual(result['integrity']['youthExpected'],1)
        self.assertEqual(result['integrity']['youthResolved'],0)
        self.assertEqual(result['integrity']['unresolvedCount'],1)

    def test_names_common_then_full_and_missing_values(self):
        self.assertEqual(self.parse([record()],names={'1':'First','2':'Last','3':'Common'})['players'][0]['displayName'],'Common')
        player=self.parse([record()],names={'1':'First','2':'Last'})['players'][0]
        self.assertEqual(player['displayName'],'First Last')
        self.assertEqual(player['growthMargin'],12)
        self.assertIsNone(player['age'])
        self.assertIsNone(player['appearances'])
        self.assertIsNone(player['weeklyWage'])

    def test_youth_contract_is_not_professional_contract(self):
        player=self.parse([record()],[member('YOUTH')])['players'][0]
        self.assertIsNone(player['contractEndYear'])

    def test_same_id_in_two_squads_is_explicitly_ambiguous(self):
        result=self.parse([record()],[member(),member('YOUTH')])
        self.assertEqual(result['integrity']['ambiguousCount'],2)
        self.assertEqual(result['players'],[])

        self.assertTrue(all('player' not in c for issue in result['issues'] for c in issue['candidates']))

    def test_record_identity_stable_across_rating_change(self):
        a=self.parse([record()])['players'][0]
        b=self.parse([record(UERs=75)])['players'][0]
        self.assertEqual(a['internalKey'],b['internalKey'])
        c=self.parse([record(tHlO=9)])['players'][0]
        self.assertNotEqual(a['internalKey'],c['internalKey'])

    def test_recorded_matches_decode_offset_without_inventing_missing_history(self):
        rows=[dict(ykFq=7,JMld=1,HBfc=180109,Amxm=91,Xxmh=10),dict(ykFq=7,JMld=2,HBfc=180119,Amxm=46,Xxmh=8)]
        self.assertEqual(match_stats(7,rows),(2,135,8.0))
        self.assertEqual(match_stats(99,rows),(None,None,None))
        self.assertEqual(match_stats(7,rows+rows),(None,None,None))

if __name__=='__main__':
    unittest.main()
