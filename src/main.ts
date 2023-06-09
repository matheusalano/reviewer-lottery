import * as core from '@actions/core'
import {runLottery} from './lottery'
import {Octokit} from '@octokit/rest'
import {getConfig} from './config'
import {getHistory, saveHistory} from './history'

async function run(): Promise<void> {
  try {
    if (!process.env.GITHUB_REF) throw new Error('missing GITHUB_REF')
    if (!process.env.GITHUB_REPOSITORY)
      throw new Error('missing GITHUB_REPOSITORY')
    //comes from {{secrets.GITHUB_TOKEN}}
    const token = core.getInput('repo-token', {required: true})
    const config = getConfig()
    const history = getHistory()

    await runLottery(new Octokit({auth: token}), config, history)

    saveHistory(history)
  } catch (error: any) {
    core.setFailed(error.message)
  }
}

run()
