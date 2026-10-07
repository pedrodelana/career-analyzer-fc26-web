import sys
import struct
import unittest
from datetime import date
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from career_dates import SIGNATURE, decode_yyyymmdd, decode_history_date, career_date_info
from normalize import normalize


def summary(raw=20260314, club=42, home=43, away=8, score=1):
    # Synthetic manager-result serialization; no real save bytes are checked in.
    data=bytearray(b'FBCHUNKS'+b'\x00'*92)
    data+=struct.pack('<I',1)+b'\x00'*20
    data+=SIGNATURE+b'\x01\x01'+struct.pack('<I',club+1)+b'\x00'*12
    data+=struct.pack('<IIIII',home,away,raw,score,2)
    return bytes(data)


def played(raw=180213, **changes):
    return dict(HBfc=raw,Amxm=91,Xxmh=8,JMld=3,ykFq=7,**changes)


class CareerDatesTest(unittest.TestCase):
    def parse(self,data=b'',rows=None):
        return career_date_info(data,42,rows or [],[dict(mCXg=42,ykFq=7)])

    def test_ltle_summary_decodes_last_completed_match_not_largest_date(self):
        data=summary()+struct.pack('<I',20301231)+b'future fixture'
        result=self.parse(data,[played(180216)])
        self.assertEqual(result,dict(lastMatchDate='2026-03-14',nextMatchDate=None,referenceDate='2026-03-14',referenceDateSource='SAVE_LAST_MATCH'))

    def test_strict_calendar_conversion(self):
        self.assertEqual(decode_yyyymmdd(20260314),'2026-03-14')
        for invalid in [20260230,20261301,20260001,20260300,0,0xffffffff,None,'20260314',True]:
            self.assertIsNone(decode_yyyymmdd(invalid))
        self.assertEqual(decode_history_date(180213),'2026-03-14')
        self.assertEqual(decode_history_date(180000),'2026-01-01')
        self.assertEqual(decode_history_date(180030),'2026-01-31')
        self.assertIsNone(decode_history_date(180129)) # February 30

    def test_fallback_only_played_participation_in_controlled_roster(self):
        rows=[played(180209),played(180213),dict(played(181001),Amxm=1),dict(played(181002),Xxmh=0),dict(played(181003),ykFq=999)]
        for data in [b'',summary(20260230),summary(score=0xffffffff),summary(club=99),summary(home=3,away=5),summary()[:-1]]:
            with self.subTest(data=data[-10:]):
                result=self.parse(data,rows)
                self.assertEqual(result['referenceDate'],'2026-03-14')
                self.assertEqual(result['referenceDateSource'],'MATCH_HISTORY')

    def test_no_completed_matches_does_not_invent_a_reference(self):
        result=self.parse(b'future'+struct.pack('<I',20260317),[dict(played(),Amxm=1)])
        self.assertEqual(result['referenceDateSource'],'UNAVAILABLE')
        self.assertIsNone(result['referenceDate'])
        self.assertIsNone(result['nextMatchDate'])

    def test_conflicting_summaries_fall_back_and_ignore_wrong_container(self):
        self.assertEqual(self.parse(summary()+summary(20260317),[played()])['referenceDateSource'],'MATCH_HISTORY')
        self.assertEqual(self.parse(b'garbage'+summary())['referenceDateSource'],'UNAVAILABLE')

    def test_age_recomputed_on_match_date_for_both_squads_without_changing_birth_or_ratings(self):
        born=(date(2006,3,15)-date(1582,10,14)).days
        records=[dict(_recordKey='a',ykFq=7,WVIU=born,UERs=68,mpuH=68),dict(_recordKey='b',ykFq=8,WVIU=born,UERs=61,mpuH=94)]
        members=[dict(playerId=7,squadType='FIRST_TEAM',teamId=42),dict(playerId=8,squadType='YOUTH',teamId=43)]
        for raw,expected in [(20260314,19),(20260315,20)]:
            ref=self.parse(summary(raw))['referenceDate']
            result=normalize(records,members,[],{},{},{},game_date=ref)
            self.assertEqual([p['age'] for p in result['players']],[expected,expected])
            self.assertEqual([p['birthDate'] for p in result['players']],['2006-03-15']*2)
            self.assertEqual([p['overall'] for p in result['players']],[69,62])


if __name__=='__main__': unittest.main()
