function logChoose(n,k){
  if(k<0||k>n)return -Infinity;k=Math.min(k,n-k);let out=0;
  for(let i=1;i<=k;i++)out+=Math.log(n-k+i)-Math.log(i);
  return out;
}
function binomHalf(n,k){return Math.exp(logChoose(n,k)-n*Math.log(2));}

export function exactMcNemar(b,c){
  const n=b+c;if(n===0)return 1;
  const m=Math.min(b,c);let tail=0;
  for(let k=0;k<=m;k++)tail+=binomHalf(n,k);
  return Math.min(1,2*tail);
}

function mulberry32(seed){
  return function(){
    let t=seed+=0x6D2B79F5;
    t=Math.imul(t^t>>>15,t|1);
    t^=t+Math.imul(t^t>>>7,t|61);
    return ((t^t>>>14)>>>0)/4294967296;
  };
}
function quantile(xs,q){
  const a=[...xs].sort((x,y)=>x-y);
  const pos=(a.length-1)*q,lo=Math.floor(pos),hi=Math.ceil(pos);
  return lo===hi?a[lo]:a[lo]*(hi-pos)+a[hi]*(pos-lo);
}

export function pairedSummary(fullRows,hiddenRows,{bootstrapReplicates=10000,seed=20261006}={}){
  const H=new Map(hiddenRows.map(r=>[r.sample_id,r]));
  const pairs=fullRows.map(f=>[f,H.get(f.sample_id)]).filter(([,h])=>h);
  let b=0,c=0;
  const diffs=[];
  for(const [f,h] of pairs){
    const fu=f.unsupported_decision?1:0,hu=h.unsupported_decision?1:0;
    if(!fu&&hu)b++;
    if(fu&&!hu)c++;
    diffs.push(hu-fu);
  }
  const rd=diffs.reduce((a,x)=>a+x,0)/diffs.length;
  const rng=mulberry32(seed),boots=[];
  for(let r=0;r<bootstrapReplicates;r++){
    let sum=0;
    for(let i=0;i<diffs.length;i++)sum+=diffs[Math.floor(rng()*diffs.length)];
    boots.push(sum/diffs.length);
  }
  return {
    n:pairs.length,
    b_full_safe_hidden_unsupported:b,
    c_full_unsupported_hidden_safe:c,
    full_udr:fullRows.filter(r=>r.unsupported_decision).length/fullRows.length,
    hidden_udr:hiddenRows.filter(r=>r.unsupported_decision).length/hiddenRows.length,
    risk_difference_hidden_minus_full:rd,
    risk_difference_bootstrap_95ci:[quantile(boots,0.025),quantile(boots,0.975)],
    exact_mcnemar_two_sided_p:exactMcNemar(b,c),
    bootstrap_replicates:bootstrapReplicates,
    bootstrap_seed:seed
  };
}
