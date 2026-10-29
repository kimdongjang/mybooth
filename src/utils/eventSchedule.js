import {koreanDay} from './revenueSummary.js';

const shortDate=value=>value.slice(2).replaceAll('-','.');
const dayNumber=value=>Date.parse(`${value}T00:00:00Z`)/86400000;
export function eventSchedule(project,today=koreanDay(new Date())) {
 const {startsOn:start,endsOn:end}=project;
 const valid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(dayNumber(value))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
 const dated=valid(start)&&valid(end)&&end>=start;
 const status=project.archivedAt?'archived':project.settlementClosedAt?'closed':!dated?'unscheduled':today<start?'upcoming':today>end?'ended':'active';
 const untilStart=dated?dayNumber(start)-dayNumber(today):0;
 const untilEnd=dated?dayNumber(end)-dayNumber(today):0;
 const countdown=status==='upcoming'?`D-${untilStart}`:status==='active'?(untilStart===0?'D-DAY':untilEnd===0?'오늘 종료':`종료 D-${untilEnd}`):status==='ended'?`종료 D+${-untilEnd}`:'';
 const period=dated?`${shortDate(start)}${start===end?'':`~${start.slice(0,4)===end.slice(0,4)?shortDate(end).slice(3):shortDate(end)}`}`:'';
 const label={archived:'보관',closed:'정산 금액 확정',unscheduled:'일정 미설정',upcoming:'진행 예정',ended:'종료',active:'진행 중'}[status];
 return {status,label,countdown,period};
}

export function sortEventsBySchedule(projects,today=koreanDay(new Date())) {
 const priority={upcoming:0,active:1,unscheduled:2,ended:3,closed:4,archived:4};
 return projects.map(project=>({project,schedule:eventSchedule(project,today)})).sort((a,b)=>{
  const order=priority[a.schedule.status]-priority[b.schedule.status];
  if(order)return order;
  const recentFirst=['ended','closed','archived'].includes(a.schedule.status);
  const left=a.schedule.period?(recentFirst?a.project.endsOn:a.project.startsOn):'';
  const right=b.schedule.period?(recentFirst?b.project.endsOn:b.project.startsOn):'';
  if(Boolean(left)!==Boolean(right))return left?-1:1;
  return (recentFirst?-1:1)*left.localeCompare(right)||String(a.project.name||'').localeCompare(String(b.project.name||''),'ko');
 }).map(({project})=>project);
}
