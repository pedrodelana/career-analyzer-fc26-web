"""Synthetic serialization fixtures: no user saves or fixed-name extraction."""
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from club_names import BNRY, MRSU, custom_metadata_name, resolve_club_name
from main import context


def text_field(value):
    raw = value.encode('utf-8')
    return b'\x01' + struct.pack('<I', len(raw)) + raw


def fixture(name='Northbridge Athletic', owner=42, token=123456, metadata_token=123456,
            abbreviation='NBA', slot='Completely unrelated save slot'):
    summary = bytearray(128)
    summary[:12] = BNRY
    summary[12:14] = b'\x01\x01'
    struct.pack_into('<I', summary, 14, owner + 1)
    struct.pack_into('<I', summary, 26, token)
    summary[68:68+len(slot)] = slot.encode('utf-8')
    header = b'FBCHUNKS' + struct.pack('<I', 1) + bytes(20)
    custom = MRSU + b'\x01'*4 + b''.join(text_field(s) for s in [name, name, 'Short name', abbreviation])
    # 88 starts with ASCII X. It must not become part of the abbreviation.
    return header + bytes(summary) + bytes(24) + BNRY + custom + struct.pack('<II', 88, metadata_token)


class CustomMetadataTest(unittest.TestCase):
    def test_different_full_names_utf8_and_slot_is_not_used(self):
        for name in ['New Era FC', 'River City United', "King’s Athletic", 'São João FC', '東京 FC', 'Team FC', 'mrsu']:
            with self.subTest(name=name):
                data = fixture(name)
                self.assertEqual(custom_metadata_name(data, 42), name)
                actual, source, evidence, method = resolve_club_name(
                    {'mCXg': 42, 'AUsv': 'Create Club Team'}, [{'zvSh': 'Manager Person'}], data)
                self.assertEqual((actual, source, method), (name, 'SAVE', 'CUSTOM_METADATA'))
                self.assertIn('mrsu', evidence[-1])

    def test_exact_lengths_stop_before_following_numeric_x(self):
        data = fixture('Long Full Club Name', abbreviation='NEW')
        self.assertIn(b'NEWX\x00\x00\x00', data)
        self.assertEqual(custom_metadata_name(data, 42), 'Long Full Club Name')

    def test_official_name_wins_over_unused_custom_metadata(self):
        actual, source, _, method = resolve_club_name(
            {'mCXg': 42, 'AUsv': 'Harrogate Town'}, [{'zvSh': 'Unrelated Person'}], fixture())
        self.assertEqual((actual, source, method), ('Harrogate Town', 'SAVE', 'TEAM_TABLE'))

    def test_owner_token_and_unique_summary_are_required(self):
        for data, club_id in [(fixture(owner=43), 42), (fixture(metadata_token=1), 42),
                              (fixture(), None), (fixture(token=0, metadata_token=0), 42),
                              (fixture()+fixture(), 42), (b'not a save'+fixture()[8:], 42)]:
            self.assertIsNone(custom_metadata_name(data, club_id))
        self.assertEqual(resolve_club_name(None, [], fixture())[1], 'UNRESOLVED')

    def test_malformed_lengths_flags_utf8_and_truncation_fall_back(self):
        data = fixture()
        first = data.index(MRSU) + len(MRSU) + 4
        invalid = [data[:first+5], data[:-1], data[:first]+b'\x02'+data[first+1:],
                   data[:first+1]+struct.pack('<I', 0xffffffff)+data[first+5:],
                   data[:first+1]+struct.pack('<I', 0)+data[first+5:],
                   data[:first+5]+b'\xff'+data[first+6:],
                   data[:first+5]+b'\x00'+data[first+6:],
                   data+MRSU+b'\x01'*4, data[:first]+BNRY+data[first:]]
        for raw in invalid:
            with self.subTest(raw_length=len(raw)):
                self.assertIsNone(custom_metadata_name(raw, 42))

    def test_placeholder_and_default_structure_remain_unresolved(self):
        for name in ['Create Club Team', 'Placeholder', 'Unnamed club']:
            self.assertIsNone(custom_metadata_name(fixture(name), 42))
        raw = fixture('Team FC', abbreviation='TFC').replace(text_field('Short name'), text_field('Team FC'))
        raw = raw[:-8]+struct.pack('<II', 0xffffffff, 123456)
        self.assertIsNone(custom_metadata_name(raw, 42))

    def test_tcem_contracts_and_player_links_gate_metadata_use(self):
        class Tables:
            data = fixture()
            records = {'lyxL': [{'mCXg': 42, 'AUsv': 'Create Club Team'}],
                       'DvsP': [{'ykFq': 7, 'mCXg': 42}], 'RrqT': [{'ykFq': 7, 'mCXg': 42}],
                       'TcEm': [{'ykFq': 7}], 'mPrV': [{'zvSh': 'Manager Person'}]}
            def rows(self, name):
                return self.records.get(name, [])
        tables = Tables()
        self.assertEqual(context(tables)[0]['clubName'], 'Northbridge Athletic')
        tables.records = {**tables.records, 'TcEm': [{'ykFq': 99}]}
        self.assertEqual(context(tables)[0]['clubNameSource'], 'UNRESOLVED')


if __name__ == '__main__':
    unittest.main()
