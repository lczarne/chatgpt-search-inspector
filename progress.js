export function captureStatus(state, demo=false, now=Date.now()) {
  if(demo)return {color:'idle',label:'Preview · sample data',detail:'',busy:false};
  if(!state.active)return {color:'idle',label:'Capture stopped',detail:'',busy:false};
  const phase=state.progress?.phase||'armed';
  const elapsed=Math.max(0,Math.floor((now-(state.progress?.since||now))/1000));
  const steps={
    armed:['Recording · waiting for a question','Send a question in ChatGPT. Search data will appear here as it becomes available.'],
    recording:['Recording · ChatGPT is responding','Receiving the response. Some search data arrives only after ChatGPT finishes writing.'],
    processing:['Recording · reading search data','The response has arrived. Reading queries and merging duplicate sources…'],
    waiting:['Recording · waiting for search data','ChatGPT may take a few more seconds to load the conversation’s search data.'],
    interrupted:['Capture interrupted','Some data could not be read. Check Diagnostics or stop and start capture again.'],
    done:['Done · results ready','Capture remains on for your next question.']
  };
  const [,detail]=steps[phase]||steps.armed;
  const busy=['recording','processing','waiting'].includes(phase);
  return {color:'active',label:'Capture active',
    detail:detail+(busy?` (${elapsed}s)`:'')+(phase==='waiting' && elapsed>=30?' No new search data has arrived yet; this response may not contain captured search results.':''),busy};
}
