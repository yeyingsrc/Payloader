const decodeProtectedText = (values: number[]) => String.fromCharCode(...values);

const xeyeUrlBytes = [
  104, 116, 116, 112, 115, 58, 47, 47, 120, 115, 115, 46, 105, 99, 117, 47,
];
const xeyeLabelBytes = [88, 101, 121, 101];
const xeyeTitleBytes = [88, 101, 121, 101, 32, 112, 108, 97, 116, 102, 111, 114, 109];

const xeyeHref = decodeProtectedText(xeyeUrlBytes);

export const protectedExternalLinks = Object.freeze({
  xeye: Object.freeze({
    label: decodeProtectedText(xeyeLabelBytes),
    title: decodeProtectedText(xeyeTitleBytes),
    href: xeyeHref,
  }),
});

export const isProtectedExternalUrl = (href: string | undefined) => href === xeyeHref;

export const openProtectedExternalLink = (href: string | undefined) => {
  if (!isProtectedExternalUrl(href)) return false;
  const opened = window.open(href, '_blank', 'noopener,noreferrer');
  if (opened) opened.opener = null;
  return true;
};
