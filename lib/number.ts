// Parsing de números vindos de planilhas/APIs em formato pt-BR ou internacional.
// pt-BR usa vírgula como separador decimal e ponto como separador de milhar
// (ex.: "1.500,00" = 1500,00). Dados internacionais usam o inverso.
export function parseLocaleNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const raw = String(value ?? "").replace(/[^\d,.-]/g, "").trim();
  if (!raw) return 0;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  let cleaned = raw;

  if (hasComma && hasDot) {
    // O separador mais à direita é o decimal; o outro é o de milhar.
    const decimalSeparator = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? "," : ".";
    const thousandSeparator = decimalSeparator === "," ? "." : ",";
    cleaned = raw.split(thousandSeparator).join("").replace(decimalSeparator, ".");
  } else if (hasComma) {
    // Só vírgula -> decimal pt-BR (remove eventuais pontos de milhar).
    cleaned = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    // Só ponto(s): decidir entre decimal e milhar. Em dados pt-BR o ponto
    // costuma ser separador de milhar (ex.: "1.500" = 1500). Tratamos como
    // decimal apenas quando o último grupo NÃO é um grupo de milhar de 3 dígitos.
    const groups = raw.replace("-", "").split(".");
    const looksLikeThousands = groups.length > 1 && groups.slice(1).every((group) => group.length === 3);
    cleaned = looksLikeThousands ? raw.split(".").join("") : raw;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}
