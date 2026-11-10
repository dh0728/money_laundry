#include <stdint.h>
#include <stdlib.h>
#include <string.h>
typedef int64_t I;
typedef struct {I *p; size_t n,cap;} Vec;
typedef struct {I id,flag;} Edge;
typedef struct {Edge *p; size_t n,cap;} Edges;
typedef struct {Vec a[8];} Result;
static int push(Vec*v,I x){if(v->n==v->cap){size_t cap=v->cap?v->cap*2:64;if(cap>SIZE_MAX/sizeof(I))return 0;void*p=realloc(v->p,cap*sizeof(I));if(!p)return 0;v->p=p;v->cap=cap;}v->p[v->n++]=x;return 1;}
static int epush(Edges*v,I id,I flag){if(v->n==v->cap){size_t cap=v->cap?v->cap*2:64;if(cap>SIZE_MAX/sizeof(Edge))return 0;void*p=realloc(v->p,cap*sizeof(Edge));if(!p)return 0;v->p=p;v->cap=cap;}v->p[v->n++]=(Edge){id,flag};return 1;}
static int cmpi(const void*a,const void*b){I x=*(const I*)a,y=*(const I*)b;return(x>y)-(x<y);}
static int cmpe(const void*a,const void*b){I x=((const Edge*)a)->id,y=((const Edge*)b)->id;return(x>y)-(x<y);}
static void unique(Vec*v){if(v->n<2)return;qsort(v->p,v->n,sizeof(I),cmpi);size_t j=1;for(size_t k=1;k<v->n;k++)if(v->p[k]!=v->p[j-1])v->p[j++]=v->p[k];v->n=j;}
static void merge(Edges*v){if(v->n<2)return;qsort(v->p,v->n,sizeof(Edge),cmpe);size_t j=1;for(size_t k=1;k<v->n;k++){if(v->p[k].id==v->p[j-1].id)v->p[j-1].flag|=v->p[k].flag;else v->p[j++]=v->p[k];}v->n=j;}
static I find(Vec*v,I x){size_t lo=0,hi=v->n;while(lo<hi){size_t m=lo+(hi-lo)/2;if(v->p[m]<x)lo=m+1;else hi=m;}return (I)lo;}
static I lower(const uint32_t*ids,const int32_t*minute,I lo,I hi,I target){while(lo<hi){I m=lo+(hi-lo)/2;if(minute[ids[m]]<target)lo=m+1;else hi=m;}return lo;}
/* A state packs account and target-minute-within-day. Multiple query
 * identities with the same state have exactly the same outgoing expansion. */
static int add_selected(Edges*edges,Vec*next,const int32_t*src,const int32_t*dst,I edge,int dir,I minute_offset){
 if(!epush(edges,edge,dir?2:1))return 0;
 if(next){I neighbor=dir?dst[edge]:src[edge];if(!push(next,neighbor*1440+minute_offset))return 0;}
 return 1;
}
static int expand_states(Vec*states,Edges*edges,Vec*next,const int32_t*src,const int32_t*dst,const int32_t*minute,I day,I cap,I nn,
 const I*ipoff,const uint32_t*ip,const I*itoff,const uint32_t*it,
 const I*opoff,const uint32_t*op,const I*otoff,const uint32_t*ot){
 I end=(day+1)*1440;
 for(size_t k=0;k<states->n;k++){
  I node=states->p[k]/1440,offset=states->p[k]%1440,target=day*1440+offset;
  if(node<0||node>=nn)return 0;
  for(int dir=0;dir<2;dir++){
   const I*poff=dir?opoff:ipoff;const uint32_t*pi=dir?op:ip;
   const I*toff=dir?otoff:itoff;const uint32_t*ti=dir?ot:it;
   I found=0;
   for(I j=poff[node];j<poff[node+1]&&found<cap;j++){
    I id=pi[j];if(minute[id]>=end||minute[id]==target)continue;
    if(!add_selected(edges,next,src,dst,id,dir,offset))return 0;found++;
   }
   I lo=lower(ti,minute,toff[node],toff[node+1],target),hi=lower(ti,minute,lo,toff[node+1],target+1);
   for(I j=lo;j<hi;j++)if(!add_selected(edges,next,src,dst,ti[j],dir,offset))return 0;
  }
 }
 return 1;
}
void free_result(Result*r){if(r){for(int k=0;k<8;k++)free(r->a[k].p);free(r);}}
I result_size(Result*r,int k){return (I)r->a[k].n;}
I*result_data(Result*r,int k){return r->a[k].p;}
Result*sample_batch(const int32_t*src,const int32_t*dst,const int32_t*minute,I width,const I*targets,I count,I nn,I cap,
 const I*ipoff,const uint32_t*ip,const I*itoff,const uint32_t*it,
 const I*opoff,const uint32_t*op,const I*otoff,const uint32_t*ot){
 Result*r=calloc(1,sizeof(Result));Vec roots={0},frontier={0},nodes={0};Edges edges={0};I*node_map=NULL;if(!r)return NULL;
 if(count<=0)goto fail;
 I day=-1;
 for(I t=0;t<count;t++){
  I id=targets[t];if(id<0||id>=width)goto fail;I s=src[id],d=dst[id],tm=minute[id],current_day=tm/1440;
  if(s<0||s>=nn||d<0||d>=nn||tm<0)goto fail;
  if(t==0)day=current_day;else if(current_day!=day)goto fail;
  if(!push(&roots,s*1440+tm%1440)||!push(&roots,d*1440+tm%1440))goto fail;
  if(!push(&nodes,s)||!push(&nodes,d))goto fail;
 }
 unique(&roots);
 if(!expand_states(&roots,&edges,&frontier,src,dst,minute,day,cap,nn,ipoff,ip,itoff,it,opoff,op,otoff,ot))goto fail;
 unique(&frontier);
 if(!expand_states(&frontier,&edges,NULL,src,dst,minute,day,cap,nn,ipoff,ip,itoff,it,opoff,op,otoff,ot))goto fail;
 merge(&edges);
 for(size_t k=0;k<edges.n;k++){I e=edges.p[k].id;if(!push(&nodes,src[e])||!push(&nodes,dst[e]))goto fail;}
 unique(&nodes);node_map=malloc((size_t)nn*sizeof(I));if(!node_map)goto fail;
 for(size_t k=0;k<nodes.n;k++){I n=nodes.p[k];if(n<0||n>=nn)goto fail;node_map[n]=(I)k;if(!push(&r->a[0],n)||!push(&r->a[7],0))goto fail;}
 for(size_t k=0;k<edges.n;k++){I e=edges.p[k].id;if(!push(&r->a[1],e)||!push(&r->a[2],node_map[src[e]])||!push(&r->a[3],node_map[dst[e]])||!push(&r->a[6],edges.p[k].flag))goto fail;}
 for(I t=0;t<count;t++){
  I id=targets[t],s=node_map[src[id]],d=node_map[dst[id]];
  if(!push(&r->a[4],s)||!push(&r->a[5],d))goto fail;r->a[7].p[s]=r->a[7].p[d]=1;
 }
 free(node_map);free(roots.p);free(frontier.p);free(nodes.p);free(edges.p);return r;
 fail:free(node_map);free(roots.p);free(frontier.p);free(nodes.p);free(edges.p);free_result(r);return NULL;
}
