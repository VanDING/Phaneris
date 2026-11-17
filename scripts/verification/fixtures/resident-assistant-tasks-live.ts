import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createResidentTaskHost } from './resident-task-host'

const [output, proxy, model, mode] = process.argv.slice(2) as [string, string, string, string]
const fixture = await createResidentTaskHost(output, body => fetch(proxy, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), {
  model, initialGoal: '这是隔离的任务管理验收，只处理合成文字，不访问文件或外部资源。本轮只回复准备就绪，不创建工作。',
})
assert((await fixture.manager.getSession(fixture.assistant.id))!.messages.some(message => message.role === 'assistant' && !message.isIntermediate && message.content.trim()), 'Live provider did not return an initial main-assistant response; inspect the provider ledger before continuing')
const scenes: string[] = [], turns: unknown[] = []
const all = async () => (await fixture.manager.getAssistantWork('alpha', { after: 0, limit: 20 })).items
const send = async (text: string) => {
  await fixture.sendMain(text)
  turns.push({ text, session: await fixture.manager.getSession(fixture.assistant.id) })
  writeFileSync(join(output, 'turns.json'), JSON.stringify(turns, null, 2))
}
const resultText = async (id: string) => {
  const work = await fixture.work(id)
  return (await fixture.manager.getSession(work.result!.sessionId))!.messages.find(message => message.id === work.result!.messageId)!.content
}
const settled = async (count: number) => fixture.until(async () => {
  const works = await all()
  assert(!works.some(work => ['failed', 'needs_attention'].includes(work.state)), JSON.stringify(works.map(work => ({ state: work.state, error: work.error }))))
  const events = await fixture.manager.assistantEvents('alpha', { limit: 100 })
  const main = (await fixture.manager.getSession(fixture.assistant.id))!
  return works.length >= count && works.every(work => work.state === 'result_ready' && work.review?.outcome === 'accepted' && work.sessionStatus === 'done'
    && events.items.some(event => event.delegationId === work.id && event.kind === 'result_ready' && event.phase === 'delivered' && !!event.delivery)) && !main.isProcessing
}, 150000)
try {
  if (mode === 'parallel') {
    await send('请自主安排两个完全独立的只读文字核算报告，分别用两个工作会话并行执行，无须再问。工作 A：代号 AQUA_6411，计算 17×19，报告代号与算式结果。工作 B：代号 COPPER_6422，计算 23×7，报告代号与算式结果。各自只给自己的要求，不混用资料。两项都授权你查阅真实结果、复核并完成；无需用户亲自验收。创建后结束本轮，等结果通知再复核交付，不循环查询。')
    await fetch(new URL('/started', proxy), { signal: AbortSignal.timeout(45000) })
    assert.equal((await all()).length, 2)
    assert((await all()).every(work => work.runtime?.isProcessing))
    await send('另聊一个独立问题：蓝色与红色混合通常得到什么颜色？直接回答，不创建工作，先前 A 和 B 继续执行。')
    assert((await all()).every(work => work.runtime?.isProcessing), 'Unrelated foreground input must preserve both Workers')
    await fetch(new URL('/release', proxy), { method: 'POST' })
    await settled(2)
    const texts = await Promise.all((await all()).map(work => resultText(work.id)))
    assert(texts.some(text => text.includes('AQUA_6411') && text.includes('323') && !text.includes('COPPER_6422')))
    assert(texts.some(text => text.includes('COPPER_6422') && text.includes('161') && !text.includes('AQUA_6411')))
    scenes.push('TM18-real-main-autonomously-dispatches-two-isolated-real-workers-in-parallel', 'TM18-unrelated-conversation-preserves-active-real-workers', 'TM18-real-inbox-review-closes-both-original-sessions')
  } else if (mode === 'revision') {
    await send('请安排一个只读文字核算工作：代号 REVISION_6433，上限原为 5，报告代号与当前上限；后续我可能修订上限。授权你管理原任务、在结果后核验并完成，不需要用户亲自验收。派发后结束本轮等待通知，不循环查询。')
    await fetch(new URL('/started', proxy), { signal: AbortSignal.timeout(45000) })
    const work = (await all())[0]!; assert(work)
    const operation = (await fixture.work(work.id)).execution!.attempts[0]!.operationId
    await send('请把刚才 REVISION_6433 的上限修正为 11，向已有任务传达这项修订。让当前轮次自然结束后处理修订，不中断，不新建任务，也不重做已经完成的操作；等回执后核验最新结果并完成。')
    const revised = await fixture.work(work.id)
    assert.equal((await all()).length, 1); assert.equal(revised.execution?.attempts[0]?.operationId, operation)
    assert(revised.controls?.some(control => control.action === 'message' && control.delivery === 'queued'))
    await fetch(new URL('/release', proxy), { method: 'POST' })
    await settled(1)
    const final = await fixture.work(work.id), text = await resultText(work.id)
    assert(text.includes('REVISION_6433') && text.includes('11'))
    assert(final.controls?.some(control => control.action === 'message' && control.processedAt))
    scenes.push('TM18-real-main-queues-revision-on-original-real-worker-without-interruption', 'TM18-real-worker-consumes-new-limit-and-main-reviews-the-revised-result')
  } else {
    await send('请完成分两阶段的只读文字工作，整项授权如下：代号 FOLLOW_6444，先安排工作会话只算 13×11，第一阶段只返回此算式结果；收到后由你读取真实结果并复核，再在原会话安排第二阶段，将已核实的第一阶段结果减去 17，最后复核完成并交付两阶段结果。不要把第二阶段提前交给第一阶段，也不要重复已算阶段；两阶段都已授权，无需再次询问。请在初次任务中保留整项原授权范围。派发后等待通知，不循环查询。')
    await fetch(new URL('/started', proxy), { signal: AbortSignal.timeout(45000) })
    await send('切换到无关闲聊：请只回答“已切换”，不创建任务，先前 FOLLOW_6444 在原授权内继续推进。')
    await fetch(new URL('/release', proxy), { method: 'POST' })
    await settled(2)
    const works = await all()
    assert.equal(works.length, 2); assert.equal(works[0]!.originMessageId, works[1]!.originMessageId); assert.equal(works[0]!.sessionId, works[1]!.sessionId)
    assert(works.some(work => work.requestId !== works[0]!.requestId && work.review?.outcome === 'accepted'))
    const texts = await Promise.all(works.map(work => resultText(work.id)))
    assert(texts.some(text => text.includes('143')) && texts.some(text => text.includes('126')))
    scenes.push('TM18-real-inbox-continues-original-grant-after-unrelated-user-input', 'TM18-real-followup-reuses-original-session-and-reviewed-results')
  }
  writeFileSync(join(output, 'live-evidence.json'), JSON.stringify({ scenes, turns, works: await all(), events: await fixture.manager.assistantEvents('alpha', { limit: 100 }),
    assistant: await fixture.manager.getSession(fixture.assistant.id) }, null, 2))
} finally {
  await fetch(new URL('/release', proxy), { method: 'POST' }).catch(() => undefined)
  writeFileSync(join(output, 'final-work.json'), JSON.stringify(await all(), null, 2))
  await fixture.close()
}
