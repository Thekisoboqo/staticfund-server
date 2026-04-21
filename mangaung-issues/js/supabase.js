import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://fjocvxhsillumijtolpf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqb2N2eGhzaWxsdW1panRvbHBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwOTE3MDEsImV4cCI6MjA4MTY2NzcwMX0.9DWRuSj6n_Fyy8jkkJwdB1LmxJo6jKoCbpoFIB1KowE';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
