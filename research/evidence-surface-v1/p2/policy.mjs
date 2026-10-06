const DECISIVE=new Set(['DECIDE','PROPOSE_CONFIRM','REVISE_OR_INVALIDATE','HONOR_OVERRIDE']);

const ROLE_WEIGHT={
  override:5,
  conflict_resolution:4,
  outcome:4,
  authority:3,
  current_fact:2,
  conflict_claim:1,
  constraint:1,
  preference:0.5,
  stale_fact:0.25,
  invalidation:5
};
const CURRENTNESS_WEIGHT={current:1,unknown:0.5,stale:0.25,superseded:0.1};

function visibleGapFallback(input){
  const ev=input.evidence;
  const constraint=ev.some(e=>e.role==='constraint');
  const feasibilityLike=ev.some(e=>e.role==='current_fact'&&(e.supports_candidates??[]).length>0);
  if(constraint&&!feasibilityLike)return 'CLARIFY';

  const authReq=ev.some(e=>e.role==='authority'&&(e.supports_candidates??[]).length===0);
  const authGrant=ev.some(e=>e.role==='authority'&&e.currentness==='current'&&(e.supports_candidates??[]).length>0);
  if(authReq&&!authGrant)return 'REQUEST_APPROVAL';

  const stale=ev.some(e=>e.role==='stale_fact');
  const currentSupported=ev.some(e=>e.role==='current_fact'&&e.currentness==='current'&&(e.supports_candidates??[]).length>0);
  if(stale&&!currentSupported)return 'DEFER';

  const conflictClaims=ev.filter(e=>e.role==='conflict_claim').length;
  const resolution=ev.some(e=>e.role==='conflict_resolution');
  if(conflictClaims>=2&&!resolution)return 'CLARIFY';

  if(input.prior_state?.prior_decision&&!ev.some(e=>e.role==='outcome'))return 'DEFER';

  return null;
}

function chooseCandidate(input){
  const scores=new Map(input.candidates.map(c=>[c.candidate_id,0]));
  for(const e of input.evidence){
    const rw=ROLE_WEIGHT[e.role]??1;
    const cw=CURRENTNESS_WEIGHT[e.currentness]??0.5;
    for(const id of e.supports_candidates??[]){
      if(scores.has(id))scores.set(id,scores.get(id)+rw*cw);
    }
  }
  return [...scores.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]??[null,0];
}

export function runDeterministicPolicy(input){
  if(input.coverage_complete===false){
    return {action_family:'DEFER',selected_candidate_id:null,reason_code:'COVERAGE_INCOMPLETE_SIGNAL',decisive:false};
  }

  const fallback=visibleGapFallback(input);
  if(fallback){
    return {action_family:fallback,selected_candidate_id:null,reason_code:'VISIBLE_GAP_'+fallback,decisive:false};
  }

  const [selected,score]=chooseCandidate(input);
  if(!selected||score<=0){
    return {action_family:'CLARIFY',selected_candidate_id:null,reason_code:'NO_POSITIVE_CANDIDATE_SUPPORT',decisive:false};
  }

  const supporting=input.evidence.filter(e=>(e.supports_candidates??[]).includes(selected));
  let action='DECIDE';
  if(supporting.some(e=>e.role==='override'||e.role==='invalidation'))action='HONOR_OVERRIDE';
  else if(input.prior_state?.prior_decision&&supporting.some(e=>e.role==='outcome'))action='REVISE_OR_INVALIDATE';

  return {action_family:action,selected_candidate_id:selected,reason_code:'VISIBLE_EVIDENCE_DECISION',decisive:DECISIVE.has(action)};
}

export const POLICY_CONFIG={ROLE_WEIGHT,CURRENTNESS_WEIGHT};
