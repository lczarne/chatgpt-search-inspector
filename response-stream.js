// Preserve byte order while Chrome enables streaming and returns buffered bytes.
export class ResponseStream {
  constructor(consume){this.consume=consume;this.decoder=new TextDecoder();this.queue=[];this.ready=false;}
  write(data){if(!data)return;if(!this.ready){this.queue.push(data);return;}this.decode(data);}
  decode(data){this.consume(this.decoder.decode(Uint8Array.from(atob(data),c=>c.charCodeAt(0)),{stream:true}));}
  start(buffered){if(buffered)this.decode(buffered);this.ready=true;for(const data of this.queue)this.decode(data);this.queue=[];}
  finish(){this.consume(this.decoder.decode());}
}
