"""Display-name resolution is independent of controlled-team identification."""
import re
import struct

BNRY = b'BNRY\x00\x00\x00\x02LTLE'
MRSU = b'\x01\x04\x00\x00\x00mrsu'


def custom_metadata_name(data, club_id):
    """Decode the observed mrsu serialization, corroborated by the manager summary.

    Four flag/u32-byte-length/UTF-8 strings follow four version bytes. The first
    is the full display name; the fourth is the abbreviation. The next integer
    can look like another character, so never scan for printable strings.
    The shared opaque token is only corroboration, NOT a career identifier.
    """
    if not isinstance(data, bytes) or not data.startswith(b'FBCHUNKS') or type(club_id) is not int:
        return None
    chunks = [match.start() for match in re.finditer(re.escape(BNRY), data)]
    summaries = []
    for start, end in zip(chunks, chunks[1:] + [len(data)]):
        if start < 24 or start + 30 > end:
            continue
        if struct.unpack_from('<I', data, start - 24)[0] == 1 and data[start+12:start+14] == b'\x01\x01':
            summaries.append((struct.unpack_from('<I', data, start+14)[0],
                              struct.unpack_from('<I', data, start+26)[0]))
    if len(summaries) != 1 or summaries[0][0] != club_id + 1:
        return None
    token = summaries[0][1]
    if token in (0, 0xffffffff):
        return None
    # Include the structure prefix: a club named "mrsu" is itself a serialized
    # string with the same marker bytes, but is not another metadata structure.
    markers = [match.start() for match in re.finditer(re.escape(MRSU + b'\x01'*4), data)]
    # More than one serialized record is ambiguous, even if one looks usable.
    if len(markers) != 1:
        return None
    marker = markers[0]
    containers = [(start, end) for start, end in zip(chunks, chunks[1:] + [len(data)])
                  if start + len(BNRY) <= marker < end]
    if len(containers) != 1:
        return None
    _, end = containers[0]
    cursor = marker + len(MRSU)
    if data[cursor:cursor+4] != b'\x01\x01\x01\x01':
        return None
    cursor += 4
    fields = []
    for _ in range(4):
        if cursor + 5 > end or data[cursor] != 1:
            return None
        length = struct.unpack_from('<I', data, cursor+1)[0]
        cursor += 5
        if not 1 <= length <= 400 or cursor + length > end:
            return None
        try:
            value = data[cursor:cursor+length].decode('utf-8', errors='strict')
        except UnicodeDecodeError:
            return None
        if not valid_club_name(value):
            return None
        fields.append(value.strip())
        cursor += length
    if cursor + 8 > end or struct.unpack_from('<I', data, cursor+4)[0] != token:
        return None
    # Official careers also carry an unused default customization structure.
    if fields == ['Team FC', 'Team FC', 'Team FC', 'TFC'] and struct.unpack_from('<I', data, cursor)[0] == 0xffffffff:
        return None
    return fields[0]

def valid_club_name(value):
    if not isinstance(value,str) or not value.strip():
        return False
    text=value.strip()
    if len(text)>100 or any(ord(char)<32 or ord(char)==127 for char in text):
        return False
    return not (re.search(r'create[ -]?(?:a[ -]?)?club|placeholder|teamname|\[do not use\]',text,re.I)
                or text.startswith(('*','<')) or text.lower() in ['unidentified club','unnamed club','unknown','n/a','team name','club name','unnamed'])

def resolve_club_name(team_row,user_rows,binary_data=b''):
    label=team_row.get('AUsv') if team_row else None
    user_labels=[row.get('zvSh') for row in user_rows if row.get('zvSh')]
    evidence=[]
    if valid_club_name(label):
        evidence.append('Display name read from the uniquely linked lyxL.AUsv team row.')
        if label in user_labels:
            evidence.append('mPrV.zvSh agrees with lyxL.AUsv.')
        return label.strip(),'SAVE',evidence,'TEAM_TABLE'
    # zvSh contains person names in the inspected files. A string alone is not
    # proof that it is a club name; never substitute it for a generic team label.
    if user_labels:
        evidence.append('mPrV.zvSh was inspected but is not corroborated as a club name.')
    custom_name=custom_metadata_name(binary_data,team_row.get('mCXg') if team_row else None)
    if custom_name:
        evidence.append('Full name decoded from length-prefixed mrsu custom metadata; manager-summary owner and shared token agree with the controlled club.')
        return custom_name,'SAVE',evidence,'CUSTOM_METADATA'
    return 'Unnamed club','UNRESOLVED',evidence,None
