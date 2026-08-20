import Image from "next/image"

export function LogoLoader() {
  return (
    <div className="flex min-h-[50vh] w-full flex-col items-center justify-center gap-6">
      <div className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-4 border-primary/20 bg-background shadow-xl">
        <Image
          src="/rosty-logo.jpeg"
          alt="Chop with Rostty"
          fill
          sizes="48px"
          className="object-cover animate-[pulse_3s_ease-in-out_infinite]"
          priority
        />
        {/* Spinning ring around the logo */}
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary animate-[spin_3s_linear_infinite]" />
      </div>
      <p className="font-syne text-sm font-semibold tracking-widest text-primary/80 uppercase animate-[pulse_3s_ease-in-out_infinite]">
        Cooking...
      </p>
    </div>
  )
}
