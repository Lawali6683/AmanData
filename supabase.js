import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
const supabaseUrl = 'https://pzyxknmysydjbszumptt.supabase.co'
const supabaseKey = 'sb_publishable_T_-kOlpwp0GLGkv0TbMGBA_YiPrL-QI' 
export const supabase = createClient(supabaseUrl, supabaseKey)