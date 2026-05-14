// =====================
// SUPABASE CONFIG
// =====================
const SUPABASE_URL = 'https://bqoenwdfjiogftacmqhb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxb2Vud2RmamlvZ2Z0YWNtcWhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNjgwNjEsImV4cCI6MjA5MzY0NDA2MX0.GpHgm4kSjiL7gXOCEOAwEgCMeMCIG7R4y4jmcIAy33o';

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
