import * as core from '@actions/core'
import {Octokit} from '@octokit/rest'
import {Config} from './config'
import {History, Reviewer} from './history'

export interface Pull {
  title: string
  user: {login: string} | null
  head: {ref: string}
  number: number
  draft?: boolean
}
interface Env {
  repository: string
  ref: string
}

class Lottery {
  octokit: Octokit
  config: Config
  env: Env
  history: History[]
  pr: Pull | undefined | null

  constructor({
    octokit,
    config,
    history,
    env
  }: {
    octokit: Octokit
    config: Config
    history: History[]
    env: Env
  }) {
    this.octokit = octokit
    this.config = config
    this.history = history
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
    } catch (error: any) {
      core.error(error)
      core.setFailed(error)
    }
  }

  async isReadyToReview(): Promise<boolean> {
    try {
      const pr = await this.getPR()
      return !!pr && !pr.draft
    } catch (error: any) {
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
      pull_number: pr,
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

      const allReviewersObject = Object.values(groups).reduce(
        (a, b) => a.concat(b),
        []
      )
      const allReviewers = [...new Set(allReviewersObject)]

      let authorHistory = this.history.filter(history => history.author === author).shift()
      if (typeof authorHistory === 'undefined') {
        authorHistory = {
          author: author,
          reviewers: []
        }
      }

      if (inGroupReviewers == null) {
        console.debug(`Group for ticket ${ticketPrefix} could not be found!`)

        return this.pickRandom(
          allReviewers,
          totalReviewersCount,
          [author],
          authorHistory
        )
      }

      delete groups[ticketPrefix]

      const outGroupReviewers = Object.values(groups).reduce(
        (a, b) => a.concat(b),
        []
      )

      console.debug(`Selecting in-group codeowners: ${inGroupCodeowners}`)
      selected = selected.concat(inGroupCodeowners)

      // This is to prevent the in-group codeowners from impacting the count of the out-group reviewers.
      totalReviewersCount = totalReviewersCount + inGroupCodeowners.length

      console.debug(`Selecting in-group reviewers`)
      selected = selected.concat(
        this.pickRandom(inGroupReviewers, inGroupReviewersCount, [
          ...selected,
          author
        ],
        authorHistory)
      )

      console.debug(`Selecting out-group reviewers`)
      selected = selected.concat(
        this.pickRandom(
          [...new Set(outGroupReviewers)],
          totalReviewersCount - selected.length,
          [...selected, author],
          authorHistory
        )
      )
    } catch (error: any) {
      core.error(error)
      core.setFailed(error)
    }

    return selected
  }

  pickRandom(items: string[], n: number, ignore: string[], history: History): string[] {
    const picks: string[] = []

    const codeowners = this.config.codeowners['FULL']
    const candidates = items.filter(
      item => !ignore.includes(item) && !codeowners.includes(item)
    )

    console.debug(`Selecting max of ${n} from ${candidates}`)

    if (candidates.length === 0) return []

    const reviewers: Reviewer[] = []
    for (const item in items) {
      let reviewer = history.reviewers.find((reviewer => reviewer.reviewer === item))
      if (typeof reviewer === 'undefined') {
        reviewer = { reviewer: item,  count: 0 }
        history.reviewers.push(reviewer)
      }
      reviewers.push(reviewer)
    }

    reviewers.sort((a, b) => a.count - b.count)

    while (picks.length < Math.min(n, candidates.length + 1)) {
      const pick = this.pickRandomReviewer(reviewers)

      if (!picks.includes(pick)) picks.push(pick)
    }

    history.reviewers.sort((a, b) => a.count - b.count)

    console.debug(`Selected: ${picks}.`)

    return picks
  }

  pickRandomReviewer(reviewers: Reviewer[]): string {
    const totalReviews = reviewers.reduce((total, current) => total + current.count, 0)
    const random = Math.floor(Math.random() * totalReviews)

    let weight = totalReviews - reviewers[0].count

    for (let index = 0; index < reviewers.length; index++) {
      const reviewer = reviewers[index]

      if (random < weight || index == reviewers.length - 1) {
        reviewer.count += 1
        return reviewer.reviewer
      }
      weight -= reviewers[index + 1].count
    }

    const reviewer = reviewers[reviewers.length - 1]
    reviewer.count += 1
    return reviewer.reviewer
  }

  async getPRAuthor(): Promise<string> {
    try {
      const pr = await this.getPR()

      return pr && pr.user ? pr.user.login : ''
    } catch (error: any) {
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
    } catch (error: any) {
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
    } catch (error: any) {
      core.error(error)
      core.setFailed(error)

      return undefined
    }
  }
}

export const runLottery = async (
  octokit: Octokit,
  config: Config,
  history: History[],
  env = {
    repository: process.env.GITHUB_REPOSITORY || '',
    ref: process.env.GITHUB_HEAD_REF || ''
  }
): Promise<void> => {
  const lottery = new Lottery({octokit, config, history, env})

  await lottery.run()
}
