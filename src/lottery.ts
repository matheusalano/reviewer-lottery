import * as core from '@actions/core'
import {Octokit} from '@octokit/rest'
import {Config} from './config'

export interface Pull {
  title: string
  user: {
    login: string
  }
  head: {
    ref: string
  }
  number: number
  draft: boolean
}
interface Env {
  repository: string
  ref: string
}

class Lottery {
  octokit: Octokit
  config: Config
  env: Env
  pr: Pull | undefined

  constructor({
    octokit,
    config,
    env
  }: {
    octokit: Octokit
    config: Config
    env: Env
  }) {
    this.octokit = octokit
    this.config = config
    this.env = {
      repository: env.repository,
      ref: env.ref
    }
    this.pr = undefined
  }

  async run(): Promise<void> {
    try {
      const ready = await this.isReadyToReview()
      if (ready) {
        const reviewers = await this.selectReviewers()
        reviewers.length > 0 && (await this.setReviewers(reviewers))
      }
    } catch (error) {
      core.error(error)
      core.setFailed(error)
    }
  }

  async isReadyToReview(): Promise<boolean> {
    try {
      const pr = await this.getPR()
      return !!pr && !pr.draft
    } catch (error) {
      core.error(error)
      core.setFailed(error)
      return false
    }
  }

  async setReviewers(reviewers: string[]): Promise<object> {
    const ownerAndRepo = this.getOwnerAndRepo()
    const pr = this.getPRNumber()

    return this.octokit.pulls.requestReviewers({
      ...ownerAndRepo,
      pull_number: pr, // eslint-disable-line @typescript-eslint/camelcase
      reviewers: reviewers.filter((r: string | undefined) => !!r)
    })
  }

  async selectReviewers(): Promise<string[]> {
    let selected: string[] = []

    const author = await this.getPRAuthor()
    const ticketPrefix = (await this.getTicketPrefix()).toUpperCase()
    const inGroupReviewersCount = this.config.in_group_reviewers
    let totalReviewersCount = this.config.total_reviewers
    const groups = this.config.groups

    try {
      const inGroupReviewers = groups[ticketPrefix]

      const inGroupCodeowners = (
        this.config.codeowners[ticketPrefix] ?? []
      ).filter(item => item !== author)

      if (inGroupReviewers == null) {
        const allReviewers = Object.values(groups).reduce(
          (a, b) => a.concat(b),
          []
        )

        return this.pickRandom(
          [...new Set(allReviewers)],
          totalReviewersCount,
          [author]
        )
      }

      delete groups[ticketPrefix]

      const outGroupReviewers = Object.values(groups).reduce(
        (a, b) => a.concat(b),
        []
      )

      selected = selected.concat(inGroupCodeowners)

      // This is to prevent the in-group codeowners from impacting the count of the out-group reviewers.
      totalReviewersCount = totalReviewersCount + inGroupCodeowners.length

      selected = selected.concat(
        this.pickRandom(inGroupReviewers, inGroupReviewersCount, [
          ...selected,
          author
        ])
      )

      selected = selected.concat(
        this.pickRandom(
          [...new Set(outGroupReviewers)],
          totalReviewersCount - selected.length,
          [...selected, author]
        )
      )
    } catch (error) {
      core.error(error)
      core.setFailed(error)
    }

    return selected
  }

  pickRandom(items: string[], n: number, ignore: string[]): string[] {
    const picks: string[] = []

    const codeowners = this.config.codeowners['FULL']
    const candidates = items.filter(
      item => !ignore.includes(item) && !codeowners.includes(item)
    )

    if (candidates.length === 0) return []

    while (picks.length < Math.min(n, candidates.length + 1)) {
      const random = Math.floor(Math.random() * candidates.length)
      const pick = candidates.splice(random, 1)[0]

      if (!picks.includes(pick)) picks.push(pick)
    }

    return picks
  }

  async getPRAuthor(): Promise<string> {
    try {
      const pr = await this.getPR()

      return pr ? pr.user.login : ''
    } catch (error) {
      core.error(error)
      core.setFailed(error)
    }

    return ''
  }

  async getTicketPrefix(): Promise<string> {
    try {
      const pr = await this.getPR()

      const titleRegex = RegExp('(?<prefix>[a-z]+|[A-Z]+)-[0-9]+')
      const branchRegex = RegExp(`^[a-z]+\/${titleRegex.source}\/.+$`)

      const titlePrefix = titleRegex.exec(pr?.title ?? '')?.groups?.prefix
      const branchPrefix = branchRegex.exec(pr?.head.ref ?? '')?.groups?.prefix

      if (titlePrefix == null && branchPrefix == null) {
        throw new Error("Ticket prefix couldn't be found.")
      }

      return branchPrefix ?? titlePrefix ?? ''
    } catch (error) {
      core.error(error)
      core.setFailed(error)
    }

    return ''
  }

  getOwnerAndRepo(): {owner: string; repo: string; head?: string} {
    const [owner, repo] = this.env.repository.split('/')

    if (this.env.ref) {
      const head = `${owner}:${this.env.ref}`
      return {owner, repo, head}
    } else {
      return {owner, repo}
    }
  }

  getPRNumber(): number {
    return Number(this.pr?.number)
  }

  async getPR(): Promise<Pull | undefined> {
    if (this.pr) return this.pr

    try {
      const {data} = await this.octokit.pulls.list({
        ...this.getOwnerAndRepo()
      })

      this.pr = data.find(({head: {ref}}) => ref === this.env.ref)

      if (!this.pr) {
        throw new Error(`PR matching ref not found: ${this.env.ref}`)
      }

      return this.pr
    } catch (error) {
      core.error(error)
      core.setFailed(error)

      return undefined
    }
  }
}

export const runLottery = async (
  octokit: Octokit,
  config: Config,
  env = {
    repository: process.env.GITHUB_REPOSITORY || '',
    ref: process.env.GITHUB_HEAD_REF || ''
  }
): Promise<void> => {
  const lottery = new Lottery({octokit, config, env})

  await lottery.run()
}
