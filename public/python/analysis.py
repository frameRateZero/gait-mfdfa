"""
analysis.py — Classification and constants for MFDFA results.
"""

def classify_multifractality(row: dict) -> str:
    robust         = row.get("robust", False)
    delta_alpha    = row.get("delta_alpha") or 0.0
    delta_alpha_nl = row.get("delta_alpha_nl") or 0.0
    p_iaaft        = row.get("p_iaaft") or 1.0
    asymmetry      = row.get("asymmetry") or 0.0

    if not robust:
        if asymmetry > 0.1 and delta_alpha_nl < 0:
            return "smoothed_constrained"
        return "unclassified"

    is_multifractal = delta_alpha > 0.1
    is_nonlinear    = delta_alpha_nl > 0.1 and p_iaaft < 0.05

    if not is_multifractal:  return "monofractal"
    if is_nonlinear:         return "nonlinear_multifractal"
    return "linear_multifractal"

CHANNEL_COLORS = {
    "a_VT":    "#2B83BA",
    "a_ML":    "#7B2D8B",
    "a_AP":    "#1D9E75",
    "g_ROLL":  "#D7191C",
    "g_PITCH": "#E66101",
    "g_YAW":   "#BA7517",
}

PRIMARY_CHANNELS    = ["a_ML", "a_AP", "g_ROLL", "g_PITCH"]
SECONDARY_CHANNELS  = ["a_VT", "g_YAW"]
ALL_CHANNELS        = ["a_VT", "a_ML", "a_AP", "g_YAW", "g_ROLL", "g_PITCH"]
