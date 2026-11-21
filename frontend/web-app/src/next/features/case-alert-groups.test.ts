import { describe, expect, it } from 'vitest'
import { episodeAlertSources, graphAlertGroups, wrappingHull } from './case-alert-groups'
import type { WorkspaceCase } from '../workspace-store'
import { cases } from '../dashboard-data'
const record = (caseId: number, transactionIds: number[], extra = {}) => ({...cases[0], revision:1, comments:[], history:[], caseId, displayId:`A-${caseId}`, kind:'ALERT', transactionIds, alertCaseIds:[], ...extra}) as WorkspaceCase
const episode = record(10,[1,2,3],{kind:'EPISODE',alertCaseIds:[1,2,404]})
describe('actual Episode Alert memberships',()=>{
 it('uses explicit membership only, retains missing source IDs and bounds transactions to Episode evidence',()=>{
  const result=episodeAlertSources(episode,[record(1,[1,2,99]),record(2,[2,3]),record(3,[1]),record(4,[3],{episodeCaseId:10})])
  expect(result.groups.map(x=>x.id)).toEqual([1,2,4])
  expect(result.groups[0].transactionIds).toEqual([1,2])
  expect(result.missingIds).toEqual([404])
 })
 it('derives shared nodes and edges from matching transaction IDs, not spatial overlap',()=>{
  const edges=[{id:'a',source:'account:1',target:'account:2',transactionIds:[1,2]},{id:'b',source:'account:2',target:'account:3',transactionIds:[3]}]
  const groups=graphAlertGroups([{id:1,label:'A-1',transactionIds:[1,2]},{id:2,label:'A-2',transactionIds:[2,3]}],edges)
  expect(groups[0].nodeIds).toEqual(['account:1','account:2'])
  expect(groups[1].edgeIds).toEqual(['a','b'])
  expect(groups[1].transactionIds).toEqual([2,3])
  expect(graphAlertGroups([{id:1,label:'A-1',transactionIds:[1]}],[])[0].nodeIds).toEqual([])
 })
 it('wraps node bounds and follows node movement without inventing membership',()=>{
  const hull=wrappingHull([{x:0,y:0},{x:300,y:100}],{width:100,height:40},10)
  expect(hull).toContain('-10,-10'); expect(hull).toContain('410,150')
  expect(wrappingHull([],{width:100,height:40},10)).toBe('')
 })
})
