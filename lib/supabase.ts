import { createClient } from '@supabase/supabase-js'

// Aqui nós usamos os NOMES das variáveis, não os valores reais
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)