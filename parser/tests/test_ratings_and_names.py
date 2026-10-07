import sys
import unittest
from copy import deepcopy
from datetime import date
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from normalize import normalize, birthday
from ratings import upgrade_snapshot, RATING_FIELDS
from club_names import resolve_club_name
from main import context


class RatingsAndDatesTest(unittest.TestCase):
    def parse(self, ovr, pot, **fields):
        return normalize([dict(_recordKey='a', ykFq=7, UERs=ovr, mpuH=pot,
                               WVIU=(date(2006, 7, 12)-date(1582, 10, 14)).days, **fields)],
                         [dict(playerId=7, squadType='FIRST_TEAM', teamId=1)], [], {}, {}, {})

    def test_all_six_reference_ratings_and_single_conversion(self):
        cases=[('Sebastian Herbert',69,69,70,70),('Daniel Woolley',68,68,69,69),
               ('Arne Christiansen',61,94,62,95),('Ricardo Barreto',50,92,51,93),
               ('Jannis Wilke',59,89,60,90),('Min Jae Ma',61,84,62,85)]
        for name,raw_ovr,raw_pot,ovr,pot in cases:
            with self.subTest(name=name):
                result=self.parse(raw_ovr,raw_pot)
                p=result['players'][0]
                self.assertEqual((p['overall'],p['potential'],p['growthMargin']),(ovr,pot,pot-ovr))
                self.assertEqual(p['rawRatings']['overall'],raw_ovr)
                self.assertEqual(upgrade_snapshot(result),result)

    def test_all_verified_attributes_offset_once_not_metadata(self):
        result=self.parse(68,68,**{key:49 for key in RATING_FIELDS},qvmK=2029,wZQU=14)
        p=result['players'][0]
        self.assertEqual(set(p['attributes'].values()),{50})
        self.assertEqual(set(p['rawRatings']['attributes'].values()),{49})
        self.assertEqual(p['contractEndYear'],2029)
        self.assertEqual(p['primaryPosition'],'MC')
        self.assertEqual(upgrade_snapshot(result),result)

    def test_legacy_snapshots_candidates_and_idempotence(self):
        old=self.parse(68,68)
        del old['normalizationVersion']
        old['players'][0].update(overall=68,potential=68,age=29)
        old['issues']=[{'code':'PLAYER_RECORD_AMBIGUOUS','candidates':[{'overall':50,'recordKey':'b'}]}]
        before=deepcopy(old)
        upgraded=upgrade_snapshot(old)
        self.assertEqual(upgraded['players'][0]['overall'],69)
        self.assertIsNone(upgraded['players'][0]['age'])
        self.assertEqual(upgraded['issues'][0]['candidates'][0]['overall'],51)
        self.assertEqual(upgrade_snapshot(upgraded),upgraded)
        self.assertEqual(old,before)
        self.assertEqual(upgraded['players'][0]['internalKey'],old['players'][0]['internalKey'])

    def test_birthday_decoded_age_unknown_without_career_date(self):
        p=self.parse(68,68)['players'][0]
        self.assertEqual(p['birthDate'],'2006-07-12')
        self.assertIsNone(p['age'])
        self.assertIsNone(birthday(None))

    def test_invalid_ratings_are_unknown(self):
        p=self.parse(None,255,SPge=-1)['players'][0]
        self.assertIsNone(p['overall'])
        self.assertIsNone(p['potential'])
        self.assertIsNone(p['growthMargin'])
        self.assertIsNone(p['attributes']['acceleration'])


class ClubNamesTest(unittest.TestCase):
    def test_official_and_safe_custom_name_from_team_table(self):
        for name in ['Harrogate Town','My Custom United']:
            actual,source,evidence,_=resolve_club_name({'AUsv':name},[{'zvSh':'Manager Person'}])
            self.assertEqual((actual,source),(name,'SAVE'))
            self.assertTrue(evidence)

    def test_placeholders_and_manager_names_are_not_club_names(self):
        for name in ['Create Club Team','Create-a-Club','Placeholder','Unknown','Team Name','Club Name','']:
            actual,source,_,_=resolve_club_name({'AUsv':name},[{'zvSh':'Sylvain Brault'}])
            self.assertEqual((actual,source),('Unnamed club','UNRESOLVED'))

    def test_controlled_club_requires_contract_roster_and_tcem_agreement(self):
        class Tables:
            data={'lyxL':[{'mCXg':1,'AUsv':'Create Club Team'},{'mCXg':2,'AUsv':'Other Club'}],
                  'RrqT':[{'ykFq':7,'mCXg':1},{'ykFq':8,'mCXg':2}],
                  'DvsP':[{'ykFq':7,'mCXg':1}],'TcEm':[{'ykFq':7}],
                  'mPrV':[{'zvSh':'Manager Person'}]}
            def rows(self,name):return self.data.get(name,[])
        tables=Tables()
        meta=context(tables)[0]
        self.assertEqual(meta['clubId'],1)
        self.assertEqual(meta['clubNameSource'],'UNRESOLVED')
        tables.data={**tables.data,'TcEm':[{'ykFq':8}]}
        self.assertIsNone(context(tables)[0]['clubId'])


if __name__=='__main__':unittest.main()
