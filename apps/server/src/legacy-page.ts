export const legacyPage = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Central Identity enrollment and recovery</title>
<style>
body{max-width:36rem;margin:3rem auto;padding:0 1rem;color:#142a42;font:16px system-ui,sans-serif}main{padding:2rem;border:1px solid #d4e0e8}label{display:block;margin:1rem 0 .35rem}input{box-sizing:border-box;width:100%;padding:.75rem;border:1px solid #9eafbd}button{margin-top:1rem;padding:.75rem 1rem;background:#175aa1;color:white;border:0;cursor:pointer}form{margin-top:2rem}#status{min-height:1.5rem}a{color:#175aa1}
</style>
<main><p><a href="/sign-in">← Back to sign in</a></p><h1>Enrollment and account recovery</h1><p id="status" role="status" aria-live="polite"></p>
<form id="register"><h2>Create a Central Identity</h2><label for="name">Name</label><input id="name" name="name" autocomplete="name" required><label for="register-email">Email address</label><input id="register-email" name="email" type="email" autocomplete="email" required><label for="register-password">Password</label><input id="register-password" name="password" type="password" autocomplete="new-password" minlength="8" required><button>Create identity</button></form>
<form id="recovery"><h2>Reset a password</h2><label for="recovery-email">Email address</label><input id="recovery-email" name="email" type="email" autocomplete="email" required><button>Send reset link</button></form>
<form id="reset" hidden><h2>Choose a new password</h2><label for="new-password">New password</label><input id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="8" required><button>Set new password</button></form>
</main>
<script>
const status=document.querySelector('#status');const params=new URLSearchParams(location.search);const token=params.get('token');document.querySelector('#reset').hidden=!token;
if(params.has('verified'))status.textContent='Email verified. You can now sign in.';else if(params.has('error'))status.textContent='This link is invalid or expired. Request a new one.';
async function send(form,endpoint,extra={}){const response=await fetch('/api/auth/'+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...Object.fromEntries(new FormData(form)),...extra})});if(!response.ok){status.textContent='The request could not be completed. Check the details or request a new link.';return}status.textContent=endpoint==='sign-up/email'?'Check your inbox for the email verification link.':endpoint==='request-password-reset'?'If an account matches that email, a reset link will be sent.':'Password updated. You can now sign in.'}
document.querySelector('#register').addEventListener('submit',event=>{event.preventDefault();send(event.currentTarget,'sign-up/email',{callbackURL:location.origin+'/legacy'})});document.querySelector('#recovery').addEventListener('submit',event=>{event.preventDefault();send(event.currentTarget,'request-password-reset',{redirectTo:location.origin+'/legacy'})});document.querySelector('#reset').addEventListener('submit',event=>{event.preventDefault();send(event.currentTarget,'reset-password',{token})});
</script></html>`;
