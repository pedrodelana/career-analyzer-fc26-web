"""Read match dates, never file timestamps or the computer's calendar.

LTLE is the endian tag of BNRY, not a database column. The manager summary
chunk (prelude index 1) carries the controlled team, participants, last-result
date and scores. Offsets below are relative to its validated BNRY signature.
The last-result date is a little-endian uint32 YYYYMMDD. The TtHG fallback has
year relative to 2008 and zero-based month/day, verified against that summary.
"""
import struct
from datetime import date

SIGNATURE = b'BNRY\x00\x00\x00\x02LTLE'


def iso_date(year, month, day):
    try:
        return date(year, month, day).isoformat() if 1900 <= year <= 2200 else None
    except (ValueError, TypeError, OverflowError):
        return None


def decode_yyyymmdd(raw):
    if type(raw) is not int:
        return None
    return iso_date(raw // 10000, raw // 100 % 100, raw % 100)


def decode_history_date(raw):
    if type(raw) is not int or raw < 0:
        return None
    return iso_date(2008 + raw // 10000, raw // 100 % 100 + 1, raw % 100 + 1)


def last_result_from_ltle(data, club_id):
    if type(club_id) is not int or not data.startswith(b'FBCHUNKS'):
        return None
    candidates = []
    cursor = 0
    while True:
        offset = data.find(SIGNATURE, cursor)
        if offset < 0:
            break
        cursor = offset + len(SIGNATURE)
        if offset < 24 or offset + 50 > len(data):
            continue
        # Match the summary's container prelude and serialization version.
        if struct.unpack_from('<I', data, offset - 24)[0] != 1 or data[offset+12:offset+14] != b'\x01\x01':
            continue
        owner = struct.unpack_from('<I', data, offset + 14)[0]
        home, away, raw_date, home_score, away_score = struct.unpack_from('<IIIII', data, offset + 30)
        # Summary IDs and scores are stored as value+1. Missing results are FF.
        if owner != club_id + 1 or owner not in (home, away) or home == away:
            continue
        if not (1 <= home <= 1000000 and 1 <= away <= 1000000 and 1 <= home_score <= 100 and 1 <= away_score <= 100):
            continue
        candidates.append(decode_yyyymmdd(raw_date))
    # Conflicting/invalid summary records must not silently pick a date.
    return candidates[0] if candidates and candidates[0] and len(set(candidates)) == 1 else None


def latest_played_history(rows, roster_ids):
    played = []
    for row in rows:
        minutes, rating = row.get('Amxm'), row.get('Xxmh')
        # Actual player participation is required; scheduled fixtures alone
        # (even with a valid future date) are not completed match evidence.
        if row.get('ykFq') not in roster_ids or type(row.get('JMld')) is not int:
            continue
        if type(minutes) is not int or not 2 <= minutes <= 181 or type(rating) is not int or not 1 <= rating <= 11:
            continue
        decoded = decode_history_date(row.get('HBfc'))
        if decoded:
            played.append(decoded)
    return max(played, default=None)


def career_date_info(data, club_id, history, links):
    last = last_result_from_ltle(data, club_id)
    source = 'SAVE_LAST_MATCH' if last else 'UNAVAILABLE'
    if not last:
        roster_ids = {r.get('ykFq') for r in links if r.get('mCXg') == club_id and club_id is not None}
        last = latest_played_history(history, roster_ids)
        if last:
            source = 'MATCH_HISTORY'
    # A fixture-date/played-status mapping is not yet validated. Never select
    # the largest date in BNRY: it also contains news, contracts and birthdays.
    return dict(lastMatchDate=last, nextMatchDate=None, referenceDate=last,
                referenceDateSource=source)
