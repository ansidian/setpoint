// When two companies are one, for Jobs: the server matches an email to its application by it, and
// the page groups a company's applications by it.

/** A company with case and punctuation ignored. */
export function companyKey(company: string): string {
  return company.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Words a company's name may carry or drop without being another company.
const COMPANY_SUFFIXES = new Set(['the', 'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'plc', 'gmbh']);

/** A company's words, without the suffixes it may carry or drop. */
export const companyWords = (company: string) => companyKey(company).split(' ').filter(word => word && !COMPANY_SUFFIXES.has(word));

/**
 * Companies match loosely: case, punctuation and "Inc." ignored, and one name may
 * be the start of the other, word by word. "Fabrikam Labs" is "Fabrikam", and "wide world" is "Wide
 * World Importers". "Northwind Talent" isn't "Northwind Traders", and "Fabrikam" isn't "Fabrikamco".
 */
export function sameCompany(a: string, b: string): boolean {
  const [short, long] = [companyWords(a), companyWords(b)].sort((x, y) => x.length - y.length) as [string[], string[]];
  return short.length > 0 && short.every((word, index) => long[index] === word);
}
