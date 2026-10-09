"""
Explainable Inspection Planning & Prioritization Engine for FloodProof.

Answers: Given a sector budget K, which sectors should an operator investigate
first—and why?

Objective Functions:
1. 'candidate_water': Prioritize highest unmitigated candidate water area.
2. 'infrastructure_exposure': Prioritize highest road & building overlap.
3. 'model_disagreement': Prioritize sectors where ML and baseline threshold conflict.
4. 'balanced': Normalized multi-criteria scoring combining water, infrastructure, and disagreement.

Features:
- Normalized score breakdown for every sector (water component, infrastructure component, disagreement component).
- Explicit natural-language explanation of why each sector is prioritized.
- Comparison against standard area-only baseline ranking.
"""

from typing import List, Dict, Any, Optional

def compute_inspection_plan(
    sectors: List[Dict[str, Any]],
    budget_k: int = 10,
    objective: str = "balanced"
) -> Dict[str, Any]:
    """
    Computes prioritized inspection plan for an operator with sector budget K.
    
    Parameters:
    - sectors: List of sector dicts containing water, infra, and disagreement metrics.
    - budget_k: Maximum number of sectors the team has capacity to inspect (default: 10).
    - objective: Strategy ('balanced', 'candidate_water', 'infrastructure_exposure', 'model_disagreement').
    
    Returns:
    - Dict with ranked plan, top K sectors with detailed explanations, and summary statistics.
    """
    if not sectors:
        return {'ranked_plan': [], 'summary': {}}
        
    budget_k = max(1, min(budget_k, len(sectors)))
    
    # 1. Determine maximums for min-max normalization
    max_cand = max((s.get('candidate_water_ha', 0.0) for s in sectors), default=1.0) or 1.0
    max_infra_road = max((s.get('road_overlap_m', 0.0) for s in sectors), default=1.0) or 1.0
    max_infra_bld = max((s.get('building_overlap_ha', 0.0) for s in sectors), default=1.0) or 1.0
    max_disagree = max((s.get('disagreement_ha', 0.0) for s in sectors), default=1.0) or 1.0
    
    # Weights based on objective
    if objective == 'candidate_water':
        w_water, w_infra, w_disagree = 1.0, 0.0, 0.0
    elif objective == 'infrastructure_exposure':
        w_water, w_infra, w_disagree = 0.2, 0.8, 0.0
    elif objective == 'model_disagreement':
        w_water, w_infra, w_disagree = 0.1, 0.0, 0.9
    else:  # 'balanced'
        w_water, w_infra, w_disagree = 0.50, 0.35, 0.15
        
    scored_sectors = []
    
    for s in sectors:
        cand_ha = s.get('candidate_water_ha', 0.0)
        road_ov_m = s.get('road_overlap_m', 0.0)
        bld_ov_ha = s.get('building_overlap_ha', 0.0)
        dis_ha = s.get('disagreement_ha', 0.0)
        settlements = s.get('settlements', [])
        
        # Combined infra score
        norm_road = road_ov_m / max_infra_road
        norm_bld = bld_ov_ha / max_infra_bld
        norm_infra = 0.5 * norm_road + 0.5 * norm_bld
        
        norm_water = cand_ha / max_cand
        norm_disagree = dis_ha / max_disagree
        
        # Final combined priority score [0.0 - 100.0]
        score_val = (w_water * norm_water + w_infra * norm_infra + w_disagree * norm_disagree) * 100.0
        
        # Build explainable rationale
        reasons = []
        if cand_ha > 0.0:
            reasons.append(f"{cand_ha:.2f} ha candidate water")
        if settlements:
            reasons.append(f"Contains settlement: {', '.join(settlements)}")
        if road_ov_m > 0.0:
            reasons.append(f"{road_ov_m:.0f}m mapped road overlap")
        if bld_ov_ha > 0.0:
            reasons.append(f"{bld_ov_ha:.2f} ha mapped building footprint overlap")
        if dis_ha > 2.0:
            reasons.append(f"High model uncertainty ({dis_ha:.2f} ha disagreement)")
            
        if not reasons:
            explanation = "Minimal water or mapped infrastructure detected."
        else:
            explanation = "; ".join(reasons)
            
        scored_sectors.append({
            **s,
            'priority_score': round(score_val, 1),
            'score_breakdown': {
                'water_component': round(w_water * norm_water * 100.0, 1),
                'infrastructure_component': round(w_infra * norm_infra * 100.0, 1),
                'disagreement_component': round(w_disagree * norm_disagree * 100.0, 1)
            },
            'inspection_rationale': explanation
        })
        
    # Rank by priority score descending
    scored_sectors.sort(key=lambda x: x['priority_score'], reverse=True)
    
    # Assign plan ranks
    for idx, s in enumerate(scored_sectors):
        s['plan_rank'] = idx + 1
        s['in_budget'] = (idx < budget_k)
        
    selected_k = scored_sectors[:budget_k]
    
    # Compare with area-only ranking (baseline)
    area_only_top_k = sorted(sectors, key=lambda x: x.get('candidate_water_ha', 0.0), reverse=True)[:budget_k]
    area_ids = set(s['id'] for s in area_only_top_k)
    selected_ids = set(s['id'] for s in selected_k)
    
    overlap_count = len(area_ids.intersection(selected_ids))
    different_sectors = list(selected_ids.symmetric_difference(area_ids))
    
    summary = {
        'budget_k': budget_k,
        'objective': objective,
        'selected_count': len(selected_k),
        'total_candidate_water_in_plan_ha': round(sum(s.get('candidate_water_ha', 0.0) for s in selected_k), 2),
        'total_road_overlap_in_plan_m': round(sum(s.get('road_overlap_m', 0.0) for s in selected_k), 1),
        'total_building_overlap_in_plan_ha': round(sum(s.get('building_overlap_ha', 0.0) for s in selected_k), 2),
        'settlements_covered': list(set(sm for s in selected_k for sm in s.get('settlements', []))),
        'comparison_with_area_baseline': {
            'common_sectors_count': overlap_count,
            'divergent_sectors': different_sectors,
            'explanation': (
                f"{overlap_count} of {budget_k} sectors match area-only sorting. "
                "The prioritized plan elevates sectors with critical infrastructure or high model ambiguity."
            )
        }
    }
    
    return {
        'objective': objective,
        'budget_k': budget_k,
        'summary': summary,
        'top_sectors': selected_k,
        'all_ranked_sectors': scored_sectors
    }
