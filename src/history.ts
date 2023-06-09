import * as core from '@actions/core'
import fs from 'fs'

export interface History {
  author: string
  reviewers: Reviewer[]
}

export interface Reviewer {
  reviewer: string
  count: number
}

export const getHistory = (): History[] => {
  const historyPath = core.getInput('history-file')

  try {
    return JSON.parse(fs.readFileSync(historyPath, 'utf8')) as History[]
  } catch (error: any) {
    return []
  }
}

export const saveHistory = (history: History[]) => {
  const historyPath = core.getInput('history-file')

  try {
    fs.writeFile(historyPath, JSON.stringify(history))
  } catch (error: any) {
    return
  }
}
