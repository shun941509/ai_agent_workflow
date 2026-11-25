import { createBlock, emptyGraph } from './graph';
import type { Block, EdgeKind, Graph } from './types';

export class Drawing {
  graph: Graph = emptyGraph();
  node(id:string,type:string,title:string,column:number,row:number,config:Block['config']={},graph?:Graph) {
    this.graph.nodes.push(createBlock(type,{id,title,x:48+column*244,y:50+row*132,config,graph}));
    return id;
  }
  edge(from:string,to:string,kind:EdgeKind,out:string,input:string,label?:string) {
    this.graph.edges.push({id:[from,out,to,input].join('/'),from,to,kind,out,input,label});
  }
  order(from:string,to:string,route='next',label?:string) { this.edge(from,to,'flow',route,'in',label); }
  data(from:string,to:string,input='input') {this.edge(from,to,'data','value',input);}
  step(from:string,to:string) {this.order(from,to);this.data(from,to);}
  doc(id:string,title:string,content:string,column:number,row:number,to:string) {
    this.node(id,'resource.context',title,column,row,{content,version:'1'});
    this.edge(id,to,'reference','ref','context',title);
  }
}
