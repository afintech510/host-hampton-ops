'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function SignupPage() {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '' })
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [couponCode, setCouponCode] = useState('')

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('submitting')
    setErrorMsg('')

    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Something went wrong')
      setCouponCode(data.couponCode || '')
      setStatus('success')
    } catch (err: any) {
      setErrorMsg(err.message)
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: mobileStyles }} />
        <div className="signup-wrap">
          <div className="signup-success-card">
            <div style={{ fontSize: 56, marginBottom: 12 }}>🎉</div>
            <h1 className="signup-heading" style={{ marginBottom: 8 }}>You&apos;re In!</h1>
            <p className="signup-body" style={{ marginBottom: 20 }}>
              Check your email — your 10% off coupon is on the way!
            </p>
            {couponCode && (
              <div className="coupon-badge">
                <p style={{ fontSize: 11, margin: '0 0 4px', opacity: 0.7, textTransform: 'uppercase', letterSpacing: 1 }}>Your Coupon Code</p>
                <p className="coupon-code">{couponCode}</p>
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <Link href="/book" className="signup-cta">
                Book Your Party &rarr;
              </Link>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: mobileStyles }} />
      <div className="signup-wrap">
        <div className="signup-card">
          {/* Header band */}
          <div className="signup-header">
            <img src="/images/host-hampton-logo.png" alt="Host Hampton" className="signup-logo" />
            <h1 className="signup-heading">Join the Host Hampton Family</h1>
            <p className="signup-subtext">
              Sign up and we&apos;ll send you 10% off your first party booking — straight to your inbox.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="signup-form">
            <div className="name-row">
              <div>
                <label className="signup-label">First Name *</label>
                <input name="firstName" required value={form.firstName} onChange={handleChange} className="signup-input" placeholder="Jane" autoComplete="given-name" />
              </div>
              <div>
                <label className="signup-label">Last Name *</label>
                <input name="lastName" required value={form.lastName} onChange={handleChange} className="signup-input" placeholder="Doe" autoComplete="family-name" />
              </div>
            </div>
            <div className="field-group">
              <label className="signup-label">Email *</label>
              <input name="email" type="email" required value={form.email} onChange={handleChange} className="signup-input" placeholder="jane@example.com" autoComplete="email" inputMode="email" />
            </div>
            <div className="field-group" style={{ marginBottom: 24 }}>
              <label className="signup-label">Phone *</label>
              <input name="phone" type="tel" required value={form.phone} onChange={handleChange} className="signup-input" placeholder="(631) 555-1234" autoComplete="tel" inputMode="tel" />
            </div>

            {status === 'error' && (
              <p className="signup-error">{errorMsg}</p>
            )}

            <button type="submit" disabled={status === 'submitting'} className="signup-btn">
              {status === 'submitting' ? 'Signing Up...' : 'Get My 10% Off Coupon'}
            </button>

            <p className="signup-fine-print">
              By signing up you agree to receive marketing emails from Host Hampton. Unsubscribe anytime.
            </p>
          </form>
        </div>
      </div>
    </>
  )
}

const mobileStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Poppins:wght@400;500;600;700&display=swap');

  .signup-wrap {
    min-height: 100vh;
    background: #F6F1EB;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .signup-card {
    max-width: 480px;
    width: 100%;
    background: #fff;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 4px 24px rgba(26,39,68,0.08);
  }

  .signup-success-card {
    max-width: 480px;
    width: 100%;
    background: #fff;
    border-radius: 16px;
    padding: 40px 28px;
    text-align: center;
    box-shadow: 0 4px 24px rgba(26,39,68,0.08);
  }

  .signup-header {
    background: linear-gradient(135deg, #A1B5C8 0%, #E8C7CB 100%);
    padding: 32px 24px;
    text-align: center;
  }

  .signup-logo {
    height: 56px;
    margin-bottom: 14px;
  }

  .signup-heading {
    font-family: 'Libre Baskerville', Georgia, serif;
    color: #1a2744;
    font-size: 22px;
    margin: 0 0 8px;
    font-weight: 700;
    line-height: 1.3;
  }

  .signup-subtext {
    font-family: 'Poppins', sans-serif;
    color: #1a2744;
    opacity: 0.8;
    font-size: 13px;
    margin: 0;
    line-height: 1.5;
  }

  .signup-body {
    font-family: 'Poppins', sans-serif;
    color: #555;
    font-size: 15px;
    line-height: 1.6;
    margin: 0;
  }

  .signup-form {
    padding: 24px 24px 28px;
  }

  .name-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 10px;
  }

  .field-group {
    margin-bottom: 10px;
  }

  .signup-label {
    display: block;
    font-family: 'Poppins', sans-serif;
    font-size: 12px;
    font-weight: 600;
    color: #1a2744;
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .signup-input {
    width: 100%;
    padding: 14px 14px;
    border: 1.5px solid #e0dcd7;
    border-radius: 8px;
    font-family: 'Poppins', sans-serif;
    font-size: 16px; /* 16px prevents iOS auto-zoom */
    color: #1a2744;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.2s;
    -webkit-appearance: none;
    appearance: none;
  }
  .signup-input:focus {
    border-color: #A1B5C8;
    box-shadow: 0 0 0 3px rgba(161,181,200,0.2);
  }

  .signup-btn {
    width: 100%;
    background: #1a2744;
    color: #F6F1EB;
    border: none;
    border-radius: 8px;
    padding: 16px;
    font-family: 'Poppins', sans-serif;
    font-weight: 600;
    font-size: 16px;
    cursor: pointer;
    transition: background 0.2s;
    -webkit-appearance: none;
    appearance: none;
    -webkit-tap-highlight-color: transparent;
  }
  .signup-btn:active {
    background: #0f1a2e;
  }
  .signup-btn:disabled {
    background: #888;
    cursor: not-allowed;
  }

  .signup-error {
    color: #c0392b;
    font-family: 'Poppins', sans-serif;
    font-size: 13px;
    margin: 0 0 16px;
    text-align: center;
  }

  .signup-fine-print {
    font-family: 'Poppins', sans-serif;
    font-size: 11px;
    color: #999;
    text-align: center;
    margin: 14px 0 0;
    line-height: 1.5;
  }

  .coupon-badge {
    background: #1a2744;
    color: #F6F1EB;
    border-radius: 8px;
    padding: 14px 20px;
    display: inline-block;
    margin-bottom: 8px;
    font-family: 'Poppins', sans-serif;
  }
  .coupon-code {
    font-family: 'Poppins', sans-serif;
    font-size: 26px;
    font-weight: 700;
    margin: 0;
    letter-spacing: 2px;
  }

  .signup-cta {
    display: inline-block;
    background: #1a2744;
    color: #F6F1EB;
    font-family: 'Poppins', sans-serif;
    font-weight: 600;
    font-size: 15px;
    padding: 14px 36px;
    border-radius: 8px;
    text-decoration: none;
    -webkit-tap-highlight-color: transparent;
  }
  .signup-cta:active {
    background: #0f1a2e;
  }

  /* ── Mobile-specific tweaks ── */
  @media (max-width: 480px) {
    .signup-wrap {
      padding: 0;
      align-items: flex-start;
    }
    .signup-card, .signup-success-card {
      border-radius: 0;
      min-height: 100vh;
      box-shadow: none;
    }
    .signup-success-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .signup-header {
      padding: 28px 20px;
    }
    .signup-heading {
      font-size: 20px;
    }
    .signup-form {
      padding: 20px 20px 28px;
    }
    .name-row {
      grid-template-columns: 1fr;
      gap: 10px;
    }
    .coupon-code {
      font-size: 22px;
    }
  }

  /* ── Larger screens ── */
  @media (min-width: 481px) {
    .signup-heading {
      font-size: 26px;
    }
    .signup-header {
      padding: 36px 32px;
    }
    .signup-logo {
      height: 64px;
      margin-bottom: 16px;
    }
    .signup-form {
      padding: 28px 32px 36px;
    }
  }
`
