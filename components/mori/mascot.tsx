import { cn } from '@/lib/utils'

type Mood = 'idle' | 'talking' | 'sleepy'

const BASE_WIDTH = 132
const BASE_HEIGHT = 120

export function Mascot({
  mood = 'idle',
  scale = 1,
  className,
}: {
  mood?: Mood
  scale?: number
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={cn('relative shrink-0', className)}
      style={{ width: BASE_WIDTH * scale, height: BASE_HEIGHT * scale }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: BASE_WIDTH, height: BASE_HEIGHT, transform: `scale(${scale})` }}
      >
        <div className="relative size-full motion-safe:animate-[mori-float_4s_ease-in-out_infinite]">
          <div className="absolute inset-x-3.5 top-0 h-16 rounded-t-full border-[7px] border-b-0 border-[#e8d2ff]" />

          <div className="absolute inset-x-3 bottom-0 top-[18px] z-10 rounded-[50%_50%_46%_46%] bg-[radial-gradient(circle_at_50%_35%,#fff8ff,#e6c6ff_30%,#a774f0_64%,#6a43b8_92%)] shadow-[inset_0_8px_16px_rgba(255,255,255,0.6),0_0_36px_rgba(201,140,255,0.55),0_0_80px_rgba(99,50,199,0.45)]">
            <Eyes mood={mood} />
            <span className="absolute left-[18px] top-[56px] h-[7px] w-[13px] rounded-full bg-[#ff9ccf]/60" />
            <span className="absolute right-[18px] top-[56px] h-[7px] w-[13px] rounded-full bg-[#ff9ccf]/60" />
            <Mouth mood={mood} />
          </div>

          <span className="absolute left-0.5 top-10 z-20 h-12 w-[22px] rounded-[14px] bg-linear-to-b from-[#efdcff] to-[#9864e5] shadow-[0_0_12px_rgba(217,169,255,0.8)]" />
          <span className="absolute right-0.5 top-10 z-20 h-12 w-[22px] rounded-[14px] bg-linear-to-b from-[#efdcff] to-[#9864e5] shadow-[0_0_12px_rgba(217,169,255,0.8)]" />
        </div>
      </div>
    </div>
  )
}

function Eyes({ mood }: { mood: Mood }) {
  if (mood === 'sleepy') {
    return (
      <>
        <span className="absolute left-[32px] top-[44px] h-[6px] w-[13px] rounded-b-full border-b-[3px] border-[#4a2a78]" />
        <span className="absolute right-[32px] top-[44px] h-[6px] w-[13px] rounded-b-full border-b-[3px] border-[#4a2a78]" />
      </>
    )
  }
  const eye =
    'absolute top-[38px] h-[14px] w-[10px] rounded-full bg-[#4a2a78] motion-safe:animate-[mori-blink_5s_ease-in-out_infinite]'
  return (
    <>
      <span className={cn(eye, 'left-[34px]')} />
      <span className={cn(eye, 'right-[34px]')} />
    </>
  )
}

function Mouth({ mood }: { mood: Mood }) {
  if (mood === 'talking') {
    return (
      <span className="absolute left-1/2 top-[56px] h-[8px] w-[12px] -translate-x-1/2 rounded-full bg-[#5a3288] motion-safe:animate-[mori-talk_0.5s_ease-in-out_infinite]" />
    )
  }
  return (
    <span className="absolute left-1/2 top-[54px] h-[7px] w-[14px] -translate-x-1/2 rounded-b-full border-b-[3px] border-[#5a3288]" />
  )
}
