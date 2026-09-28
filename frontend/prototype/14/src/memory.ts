import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
// In-memory prototype state survives navigation, and resets on a full reload.
const memory = new Map<string, unknown>()
export function useMemoryState<T>(key:string, initial:T):[T,Dispatch<SetStateAction<T>>]{
  const [value,setValue]=useState<T>(()=>memory.has(key)?memory.get(key) as T:initial)
  useEffect(()=>{memory.set(key,value)},[key,value])
  return [value,setValue]
}
