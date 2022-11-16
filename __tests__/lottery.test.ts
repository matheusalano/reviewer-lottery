import {Octokit} from '@octokit/rest'
import nock from 'nock'
import {runLottery, Pull} from '../src/lottery'

var author = 'B'
var groupName = 'GROUPA'
var draft = false

const octokit = new Octokit()
const prNumber = 123
const ref = () => {
  return `feature/${groupName}-10/noop-branch`
}
const pull = () => {
  return {
    title: `${groupName}-10: Title`,
    number: prNumber,
    head: {ref: ref()},
    user: {login: author},
    draft: draft
  }
}

const config = {
  total_reviewers: 2,
  in_group_reviewers: 1,
  codeowners: {
    FULL: ['B', 'C'],
    GROUPC: ['F']
  },
  groups: {
    GROUPA: ['A', 'B'],
    GROUPB: ['C', 'A', 'E'],
    GROUPC: ['B', 'F', 'E']
  }
}

const mockGetPull = (pull: Pull) =>
  nock('https://api.github.com')
    .get(
      `/repos/matheusalano/repository/pulls?head=matheusalano:${pull.head.ref}`
    )
    .reply(200, [pull])

beforeEach(() => {
  author = 'B'
  groupName = 'GROUPA'
  draft = false
})

test('selects in-group reviewers first, then out-group reviewers', async () => {
  groupName = 'GROUPA'

  const getPullMock = mockGetPull(pull())

  const outGroupCandidates = ['A', 'E', 'F']

  const postReviewersMock = nock('https://api.github.com')
    .post(
      `/repos/matheusalano/repository/pulls/${prNumber}/requested_reviewers`,
      (body): boolean => {
        expect(body.reviewers[0]).toEqual('A')
        expect(outGroupCandidates).toContain(body.reviewers[1])

        return true
      }
    )
    .reply(200, pull)

  await runLottery(octokit, config, {
    repository: 'matheusalano/repository',
    ref: ref()
  })

  getPullMock.done()
  postReviewersMock.done()

  nock.cleanAll()
})

test("doesn't assign reviewers if the PR is in draft state", async () => {
  draft = true

  const getPullMock = mockGetPull(pull())

  await runLottery(octokit, config, {
    repository: 'matheusalano/repository',
    ref: ref()
  })

  getPullMock.done()
  nock.cleanAll()
})

test("doesn't assign in-group reviewers if the only option is a CO", async () => {
  author = 'A'

  const getPullMock = mockGetPull(pull())

  const outGroupCandidates = ['E', 'F']

  const postReviewersMock = nock('https://api.github.com')
    .post(
      `/repos/matheusalano/repository/pulls/${prNumber}/requested_reviewers`,
      (body): boolean => {
        expect(body.reviewers).toHaveLength(2)
        body.reviewers.forEach((reviewer: string) => {
          expect(outGroupCandidates).toContain(reviewer)
        })

        return true
      }
    )
    .reply(200, pull)

  await runLottery(octokit, config, {
    repository: 'matheusalano/repository',
    ref: ref()
  })

  postReviewersMock.done()
  getPullMock.done()
  nock.cleanAll()
})

test("assign any reviewers if the group doesn't exist", async () => {
  groupName = 'GroupD'

  const getPullMock = mockGetPull(pull())

  const candidates = ['A', 'E', 'F']

  const postReviewersMock = nock('https://api.github.com')
    .post(
      `/repos/matheusalano/repository/pulls/${prNumber}/requested_reviewers`,
      (body): boolean => {
        expect(body.reviewers).toHaveLength(2)

        body.reviewers.forEach((reviewer: string) => {
          expect(candidates).toContain(reviewer)
        })
        return true
      }
    )
    .reply(200, pull)

  await runLottery(octokit, config, {
    repository: 'matheusalano/repository',
    ref: ref()
  })

  getPullMock.done()
  postReviewersMock.done()

  nock.cleanAll()
})

test('assign all in-group codeowners before picking other reviewers', async () => {
  groupName = 'GROUPC'

  const getPullMock = mockGetPull(pull())

  const postReviewersMock = nock('https://api.github.com')
    .post(
      `/repos/matheusalano/repository/pulls/${prNumber}/requested_reviewers`,
      (body): boolean => {
        expect(body.reviewers).toEqual(['F', 'E', 'A'])

        return true
      }
    )
    .reply(200, pull)

  await runLottery(octokit, config, {
    repository: 'matheusalano/repository',
    ref: ref()
  })

  getPullMock.done()
  postReviewersMock.done()

  nock.cleanAll()
})
