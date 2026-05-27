import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envText = fs.readFileSync(".env.local", "utf8");
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.trim().startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const branches = [
  ["01", "ABAETETUBA 1", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888000184"],
  ["02", "CAPANEMA 1", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888000265"],
  ["03", "CASTANHAL 1", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888000346"],
  ["04", "CAMETA 1", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888000427"],
  ["05", "CAPITAO POCO", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888000770"],
  ["06", "SANTA ISABEL", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888000850"],
  ["07", "ABAETETUBA 2", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888000508"],
  ["08", "CASTANHAL 2", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888001156"],
  ["09", "BARCARENA", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888001237"],
  ["10", "QUATRO BOCAS", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888001318"],
  ["11", "CASTANHAL 3", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888001407"],
  ["12", "ITAITUBA 1", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888001580"],
  ["13", "ITAITUBA 2", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888001660"],
  ["14", "POCONE", "R. O. MARTINS PEREIRA & CIA LTDA", "MT", "22166562000142"],
  ["15", "PEDRA 90", "R. O. MARTINS PEREIRA & CIA LTDA", "MT", "22166562000223"],
  ["16", "TIJUCAL", "R. O. MARTINS PEREIRA & CIA LTDA", "MT", "22166562000304"],
  ["17", "MEGA", "R. O. MARTINS PEREIRA & CIA LTDA", "MT", "22166562000576"],
  ["18", "CASTANHAL 4", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888001741"],
  ["19", "CASTANHAL 5", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888001822"],
  ["20", "MAE DO RIO", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888001903"],
  ["21", "CAPANEMA 2", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888002128"],
  ["22", "PORTEL", "CELIDONIO E OLIVO FARMACIA LTDA", "PA", "30870888002047"],
];

const fullRows = branches.map(([code, name, legal_name, uf, cnpj]) => ({
  code,
  name,
  city: "",
  legal_name,
  uf,
  cnpj,
  is_active: true,
}));

const basicRows = branches.map(([code, name]) => ({
  code,
  name,
  city: "",
  is_active: true,
}));

let { error } = await supabase
  .from("pricing_branches")
  .upsert(fullRows, { onConflict: "code" });

if (error && String(error.code || "") === "PGRST204") {
  ({ error } = await supabase
    .from("pricing_branches")
    .upsert(basicRows, { onConflict: "code" }));
}

if (error) {
  console.error(error);
  process.exit(1);
}

console.log(`Filiais cadastradas/atualizadas: ${branches.length}`);
