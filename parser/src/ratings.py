"""The single conversion boundary for FC26 raw rating values.

Verified CZUM fields from the pinned upstream data/field_labels.json. Metadata
such as wages, positions, dates, stars and match ratings is deliberately absent.
"""
from copy import deepcopy

NORMALIZATION_VERSION = 2
RATING_FIELDS = {
    'SPge': 'acceleration', 'NrcP': 'sprint_speed', 'RRQB': 'agility',
    'onkY': 'balance', 'URGo': 'jumping', 'nmgT': 'strength', 'XjDq': 'stamina',
    'iTce': 'aggression', 'wWzG': 'interceptions', 'XsFD': 'att_position',
    'YCnI': 'reactions', 'ZoOK': 'vision', 'jlQJ': 'composure',
    'xrSG': 'gk_diving', 'eYFI': 'gk_reflexes', 'kqda': 'gk_kicking',
    'GBGj': 'gk_handling', 'yfhq': 'gk_positioning', 'MgwU': 'ball_control',
    'wGOH': 'crossing', 'YFaA': 'curve', 'SJKz': 'def_awareness',
    'nEbM': 'dribbling', 'xJZL': 'finishing', 'VgKc': 'fk_accuracy',
    'aReg': 'heading_accuracy', 'kerE': 'long_passing', 'CsBG': 'long_shots',
    'AGsE': 'penalties', 'vObb': 'short_passing', 'ohpV': 'shot_power',
    'PhuM': 'sliding_tackle', 'CsyD': 'standing_tackle', 'Dydz': 'volleys',
}

def display_rating(raw):
    if not isinstance(raw, int) or isinstance(raw, bool) or not 0 <= raw <= 99:
        return None
    return raw + 1

def normalize_ratings(raw):
    overall, potential = display_rating(raw.get('overall')), display_rating(raw.get('potential'))
    return dict(overall=overall, potential=potential,
                growthMargin=potential-overall if overall is not None and potential is not None else None,
                attributes={key: display_rating(value) for key, value in raw.get('attributes', {}).items()},
                rawRatings=deepcopy(raw))

def upgrade_snapshot(snapshot):
    """Upgrade legacy cached JSON once; preserve all identifiers and provenance."""
    result = deepcopy(snapshot)
    version = result.get('normalizationVersion', 1)
    if version == NORMALIZATION_VERSION:
        return result
    if version != 1:
        raise ValueError('Unsupported normalization version')
    for player in result.get('players', []):
        raw = dict(overall=player.get('overall'), potential=player.get('potential'), attributes={})
        player.update(normalize_ratings(raw))
        # Legacy caches never had a verified career calendar.
        player['age'] = None
    for issue in result.get('issues', []):
        for candidate in issue.get('candidates', []):
            candidate['overall'] = display_rating(candidate.get('overall'))
    result['normalizationVersion'] = NORMALIZATION_VERSION
    return result
