import * as core from '@actions/core'
import yaml from 'js-yaml'
import fs from 'fs'

export interface Config {
  total_reviewers: number
  in_group_reviewers: number
  codeowners: {[key: string]: string[]}
  groups: {[key: string]: string[]}
}

export const getConfig = (): Config => {
  const configPath = core.getInput('config', {required: true})

  try {
    const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as Config

    if (config.in_group_reviewers > config.total_reviewers) {
      throw new Error(
        '`total_reviewers` has to be greater or equal to `in_group_reviewers`'
      )
    }

    return config
  } catch (error: any) {
    core.setFailed(error.message)
  }

  return {total_reviewers: 0, in_group_reviewers: 0, codeowners: {}, groups: {}}
}
