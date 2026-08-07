import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('c:/Users/admin/Desktop/antigravity/.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
const action = process.argv[2];
if (action === 'create') {
  const { data } = await admin.auth.admin.createUser({ phone: '+84900000080', password: 'test123456', phone_confirm: true });
  await admin.from('profiles').update({ status: 'approved', role: 'admin', full_name: 'UI Test NhiemKhuan' }).eq('id', data.user.id);
  console.log('CREATED', data.user.id);
} else {
  const { data } = await admin.auth.admin.listUsers();
  const u = data.users.find((x) => x.phone === '84900000080');
  if (u) { await admin.auth.admin.deleteUser(u.id); console.log('DELETED user'); }
  // Xoa luon material test tao ra (so lo bat dau bang "TESTNK")
  const { data: mats } = await admin.from('materials').select('id, so_lo').ilike('so_lo', 'TESTNK%');
  if (mats && mats.length) {
    await admin.from('materials').delete().in('id', mats.map(m => m.id));
    console.log('DELETED', mats.length, 'material rows');
  }
}
