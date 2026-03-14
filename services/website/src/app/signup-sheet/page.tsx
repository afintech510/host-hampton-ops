import QRCode from 'qrcode'

export default async function SignupSheetPage() {
  const signupUrl = 'https://www.hosthampton.com/signup'
  const qrDataUrl = await QRCode.toDataURL(signupUrl, {
    width: 160,
    margin: 1,
    color: { dark: '#1a2744', light: '#ffffff' },
  })

  const rows = Array.from({ length: 15 }, (_, i) => i)

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: printStyles }} />
      <div className="signup-sheet">
        {/* ── Top dusty blue band with logo + QR ── */}
        <div className="top-band">
          <div className="top-band-content">
            <div className="top-qr">
              <img src={qrDataUrl} alt="QR Code" className="qr-code" />
              <p className="qr-text">Scan to sign up<br />instantly &amp; get<br />your 10% off!</p>
            </div>
            <div className="top-center">
              <img src="/images/host-hampton-logo.png" alt="Host Hampton" className="logo" />
              <h1 className="headline">Join the Party!</h1>
              <p className="subheadline">Sign up &amp; get 10% off your first party booking</p>
            </div>
            <div className="top-qr-spacer" />
          </div>
        </div>

        {/* ── Signup table ── */}
        <table className="signup-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i} className={i % 2 === 1 ? 'alt' : ''}>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── Bottom dusty blue band ── */}
        <div className="bottom-band">
          <p className="footer-text">hosthampton.com&nbsp; |&nbsp; @hosthampton&nbsp; |&nbsp; (631) 998-9325</p>
        </div>
      </div>
    </>
  )
}

/* ─── All styles are inline/print-optimized ─── */
const printStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Poppins:wght@400;500;600&display=swap');

  /* ── Screen + Print shared ── */
  .signup-sheet {
    width: 8.5in;
    min-height: 11in;
    margin: 0 auto;
    background: #ffffff;
    position: relative;
    overflow: hidden;
    box-sizing: border-box;
  }

  .top-band {
    background: linear-gradient(180deg, #A1B5C8 0%, #A1B5C8 55%, rgba(161,181,200,0) 100%);
    padding: 0.3in 0.5in 0.5in;
  }
  .top-band-content {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .top-qr {
    text-align: center;
    flex-shrink: 0;
    width: 1.6in;
  }
  .top-qr-spacer {
    width: 1.6in;
    flex-shrink: 0;
  }
  .top-center {
    text-align: center;
    flex: 1;
  }
  .logo {
    height: 1in;
    width: auto;
    margin-bottom: 0.05in;
  }

  .headline {
    font-family: 'Libre Baskerville', Georgia, serif;
    color: #1a2744;
    font-size: 30pt;
    margin: 0 0 0.03in;
    font-weight: 700;
    line-height: 1.2;
  }
  .subheadline {
    font-family: 'Poppins', Arial, sans-serif;
    color: #C9A9A6;
    font-size: 12pt;
    margin: 0;
    font-weight: 500;
  }

  /* ── Table ── */
  .signup-table {
    width: 7.3in;
    margin: 0.2in auto 0;
    border-collapse: collapse;
    font-family: 'Poppins', Arial, sans-serif;
  }
  .signup-table th {
    background: #1a2744;
    color: #F6F1EB;
    font-size: 10pt;
    font-weight: 600;
    text-align: left;
    padding: 6px 10px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .signup-table th:first-child { border-radius: 4px 0 0 0; }
  .signup-table th:last-child  { border-radius: 0 4px 0 0; }
  .signup-table td {
    height: 0.48in;
    border-bottom: 1px solid #e0dcd7;
    padding: 0 10px;
    font-size: 10pt;
  }
  .signup-table tr.alt td {
    background: #f7f5f2;
  }
  .signup-table th:nth-child(1),
  .signup-table td:nth-child(1) { width: 35%; }
  .signup-table th:nth-child(2),
  .signup-table td:nth-child(2) { width: 25%; }
  .signup-table th:nth-child(3),
  .signup-table td:nth-child(3) { width: 40%; }

  /* ── QR code (top-left) ── */
  .qr-code {
    width: 1.2in;
    height: 1.2in;
    border: 2px solid #ffffff;
    border-radius: 6px;
  }
  .qr-text {
    font-family: 'Poppins', Arial, sans-serif;
    font-size: 7.5pt;
    color: #1a2744;
    margin: 3px 0 0;
    line-height: 1.35;
    font-weight: 500;
  }

  /* ── Bottom band ── */
  .bottom-band {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1.2in;
    background: linear-gradient(0deg, #A1B5C8 0%, #A1B5C8 40%, rgba(161,181,200,0) 100%);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 0.25in;
  }
  .footer-text {
    font-family: 'Poppins', Arial, sans-serif;
    font-size: 10pt;
    color: #1a2744;
    margin: 0;
    font-weight: 500;
    letter-spacing: 0.3px;
  }

  /* ── Print-specific ── */
  @media print {
    @page {
      size: letter portrait;
      margin: 0;
    }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .signup-sheet {
      width: 100%;
      min-height: 100vh;
      margin: 0;
    }
  }

  /* ── Screen preview helper ── */
  @media screen {
    body { background: #ddd; }
    .signup-sheet {
      margin: 20px auto;
      box-shadow: 0 2px 20px rgba(0,0,0,0.15);
    }
  }
`
