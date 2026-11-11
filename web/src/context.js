import { createContext, useContext } from 'react'

export const ProjectCtx = createContext(null)
export const useProject = () => useContext(ProjectCtx)
