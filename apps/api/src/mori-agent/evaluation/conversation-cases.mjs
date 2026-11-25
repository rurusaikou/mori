const noCurrentTrack = {
  currentTrack: null,
  playbackState: { status: 'none', currentTrack: null, previousTrack: null, availability: 'needs-auth' },
  worldState: { timeZone: 'Asia/Tokyo' },
  fakeMemory: [],
}

export const UNIFIED_CONVERSATION_CASES = [
  {
    id: 'teacher-reunion-roles',
    description: 'Preserve the teacher/husband relation and avoid unsupported rest/work claims.',
    input: {
      ...noCurrentTrack,
      userMessage: '对啊，老师要去美国了～～～跟老公团聚咯～～',
      conversationHistory: [
        { role: 'user', content: '今天工作累累的，但是刚刚上日语课，跟老师聊了一下天，感觉心情好了很多。' },
        { role: 'assistant', content: '心情变好是因为那些交流吗？' },
        { role: 'user', content: '对的' },
        { role: 'assistant', content: '日语课上的交流一定很愉快吧？' },
      ],
    },
    expectedAny: ['老师', '团聚'],
    forbidden: ['你要去见老师', '老师平时工作辛苦', '老师终于能好好休息'],
  },
  {
    id: 'short-continuation-target',
    description: 'Resolve a short agreement against the latest teacher-reunion topic, not old work fatigue.',
    input: {
      ...noCurrentTrack,
      userMessage: '对呀对呀。',
      conversationHistory: [
        { role: 'user', content: '对啊，老师要去美国了～～～跟老公团聚咯～～' },
        { role: 'assistant', content: '能和老公团聚一定很幸福吧。' },
      ],
    },
    expectedAny: ['老师', '团聚', '丈夫', '美国'],
    forbidden: ['工作很累', '日语课上的交流一定很愉快'],
  },
  {
    id: 'omitted-subject-luggage',
    description: 'Do not invent that the user is travelling to visit the teacher.',
    input: {
      ...noCurrentTrack,
      userMessage: '紧急收拾行李中哈哈哈',
      conversationHistory: [
        { role: 'user', content: '老师要去美国了～～～跟老公团聚咯～～' },
        { role: 'assistant', content: '能和老公团聚一定很幸福吧。' },
      ],
    },
    expectedAny: ['老师', '行李', '出发', '准备'],
    forbidden: ['你要去见老师', '你要去美国', '你去见老师'],
  },
  {
    id: 'hesitation-feedback',
    description: 'Treat hesitation as possible feedback to Mori latest reply, not as old fatigue context.',
    input: {
      ...noCurrentTrack,
      userMessage: 'emmmmmm',
      conversationHistory: [
        { role: 'user', content: '紧急收拾行李中哈哈哈' },
        { role: 'assistant', content: '看来是要去见老师啦，这趟旅程一定很特别吧？' },
      ],
    },
    expectedAny: ['刚才', '误会', '理解', '不太对', '说错', '哪里'],
    forbidden: ['工作很累', '之前的疲惫', '上日语课后心情变好'],
  },
]