/**
 * Typography for bare block children (h1/h2/p/ul/blockquote…), shared by
 * the page root and Column containers so pages stay bare JSX.
 */
export const TEXT_STYLES = [
  '[&>h1]:text-3xl [&>h1]:font-semibold [&>h1]:tracking-tight',
  '[&>h2]:mt-8 [&>h2]:text-xl [&>h2]:font-semibold [&>h2]:tracking-tight',
  '[&>h3]:mt-6 [&>h3]:text-lg [&>h3]:font-medium',
  // min-heights keep freshly created empty blocks visible and clickable
  '[&>p]:leading-7 [&>p]:text-[15px] [&>p]:min-h-7 [&>h2]:min-h-7 [&>h3]:min-h-7',
  '[&>ul]:list-disc [&>ul]:pl-6 [&>ul]:text-[15px] [&>ul]:leading-7',
  '[&>ol]:list-decimal [&>ol]:pl-6 [&>ol]:text-[15px] [&>ol]:leading-7',
  '[&>blockquote]:border-l-2 [&>blockquote]:pl-4 [&>blockquote]:text-muted-foreground [&>blockquote]:italic',
].join(' ')
