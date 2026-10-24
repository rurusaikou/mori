import { MoriApp } from '@/components/mori/mori-app'
import { PrototypeIntro } from '@/components/mori/prototype-intro'

export default function Page() {
  return (
    <div className="min-h-dvh bg-[#0c0918] md:grid md:place-items-center md:bg-[radial-gradient(circle_at_20%_10%,#3d2f63,transparent_40%),radial-gradient(circle_at_85%_90%,#3a1f4a,transparent_35%)] md:p-6">
      <div className="md:flex md:items-center md:gap-16">
        <PrototypeIntro />
        <MoriApp />
      </div>
    </div>
  )
}
