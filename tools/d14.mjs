import { C, F, M, doc, txt, box, line, path, header, wrap } from "./theme.mjs";

const W = 1200;
const H = 780;

function decision(x, y, w, h, text, color = C.info) {
  return box(x, y, w, h, { fill: C.panelAlt, stroke: color, sw: 1.6 }) +
    wrap(x + w / 2, y + 31, text, { size: 16, lh: 22, width: w - 32, weight: 700, fill: C.text, anchor: "middle" });
}
function answer(x, y, w, h, title, sub, color) {
  const titleSize = title.length > 14 ? 15 : title.length > 11 ? 16 : 18;
  return box(x, y, w, h, { fill: C.panel, stroke: color, sw: 1.8 }) +
    txt(x + w / 2, y + 31, title, { size: titleSize, weight: 700, anchor: "middle", fill: color }) +
    wrap(x + w / 2, y + 55, sub, { size: 12, lh: 17, width: w - 28, anchor: "middle", fill: C.muted });
}
function arrow(x1,y1,x2,y2,label,color=C.dim){
  return path(`M ${x1} ${y1} L ${x2} ${y2}`, { stroke: color, sw: 1.8, marker:"arw" }) +
    txt((x1+x2)/2 + (x1===x2?14:0), (y1+y2)/2 - (y1===y2?8:0), label, { size:11, weight:700, fill:color, anchor:x1===x2?"start":"middle" });
}

export function build(){
  let b=header(W,"Which limiter do I actually need?","A decision tree for the Monday after you finish this article");

  // root
  b+=decision(450,132,300,64,"What are you protecting?");

  // first split
  b+=answer(70,268,230,82,"FAIRNESS","One caller must not consume everyone else's share.",C.info);
  b+=answer(355,268,230,82,"AN EXPENSIVE THING","CPU, DB connections, LLM tokens, or money.",C.warn);
  b+=answer(640,268,230,82,"THE WHOLE SERVICE","The fleet is already slowing down.",C.bad);
  b+=answer(925,268,230,82,"AN UPSTREAM API","You are the client receiving 429s.",C.purple);

  b+=arrow(498,196,185,262,"per caller",C.info);
  b+=arrow(548,196,470,262,"resource",C.warn);
  b+=arrow(652,196,755,262,"global",C.bad);
  b+=arrow(702,196,1040,262,"outbound",C.purple);

  // branch 1
  b+=decision(60,404,250,64,"Do short bursts need to work?",C.info);
  b+=answer(25,540,150,90,"TOKEN BUCKET","Usually yes. Best default.",C.good);
  b+=answer(195,540,150,90,"SLIDING WINDOW","Exact trailing fairness.",C.info);
  b+=arrow(130,468,100,534,"yes",C.good);
  b+=arrow(240,468,270,534,"no / exact",C.info);

  // branch 2
  b+=decision(350,404,250,64,"Is the cost held over time?",C.warn);
  b+=answer(355,540,145,90,"CONCURRENCY","Cap work in flight.",C.purple);
  b+=answer(515,540,145,90,"COST BUDGET","Spend weighted units.",C.warn);
  b+=arrow(435,468,428,534,"yes",C.purple);
  b+=arrow(535,468,588,534,"no",C.warn);

  // branch 3
  b+=decision(640,404,250,64,"Can latency tell you early?",C.bad);
  b+=answer(675,540,145,90,"ADAPTIVE","Shrink before errors.",C.good);
  b+=answer(835,540,145,90,"LOAD SHEDDER","Drop low priority first.",C.bad);
  b+=arrow(725,468,748,534,"yes",C.good);
  b+=arrow(830,468,908,534,"already on fire",C.bad);

  // branch 4
  b+=decision(930,404,230,64,"Did it send Retry-After?",C.purple);
  b+=answer(995,540,170,90,"BACKOFF + JITTER","Respect the header. Otherwise use full jitter.",C.purple);
  b+=arrow(1045,468,1080,534,"either way",C.purple);

  b+=line(90,680,1110,680,{stroke:C.stroke,sw:1});
  b+=txt(W/2,716,"These compose. A mature API normally runs several at once because each answers a different question.",{
    size:19,weight:600,anchor:"middle",fill:C.warn
  });
  b+=txt(W/2,748,"Start with token bucket per authenticated customer. Add the next layer only when its failure appears.",{
    size:15,anchor:"middle",fill:C.muted
  });
  return doc(W,H,b);
}
