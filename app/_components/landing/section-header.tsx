type SectionHeaderProps = {
  eyebrow: string;
  title: string;
  body: string;
};

export function SectionHeader({ eyebrow, title, body }: SectionHeaderProps) {
  return (
    <div className="max-w-3xl">
      <p className="mb-3 text-sm font-medium text-[#267369]">
        {eyebrow}
      </p>
      <h2 className="text-3xl font-semibold leading-tight text-[#242729] md:text-4xl">
        {title}
      </h2>
      <p className="mt-5 text-base leading-7 text-[#677078]">{body}</p>
    </div>
  );
}
