import QRCode from 'qrcode'

export default async function SignupSheetPage() {
  const signupUrl = 'https://www.hosthampton.com/signup'
  const qrDataUrl = await QRCode.toDataURL(signupUrl, {
    width: 160,
    margin: 1,
    color: { dark: '#1a2744', light: '#ffffff' },
  })

  const rows = Array.from({ length: 20 }, (_, i) => i)

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: printStyles }} />
      <div className="signup-sheet">
        {/* ── Top dusty blue band ── */}
        <div className="top-band">
          <div className="top-row">
            <img src="/images/host-hampton-logo.png" alt="Host Hampton" className="logo" />
            <div className="top-center">
              <h1 className="headline">Join the Party!</h1>
              <p className="subheadline">Sign up &amp; get 10% off your first party booking</p>
            </div>
            <div className="top-qr">
              <img src={qrDataUrl} alt="QR Code" className="qr-code" />
              <p className="qr-text">Scan to sign up &amp;<br />get your 10% off!</p>
            </div>
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

const printStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Poppins:wght@400;500;600&display=swap');

  .signup-sheet {
    width: 8.5in;
    height: 11in;
    margin: 0 auto;
    background: #ffffff;
    position: relative;
    overflow: hidden;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }

  /* ── Top band ── */
  .top-band {
    background: linear-gradient(180deg, #A1B5C8 0%, #A1B5C8 60%, rgba(161,181,200,0) 100%);
    padding: 0.25in 0.4in 0.4in;
    flex-shrink: 0;
  }
  .top-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .logo {
    height: 0.9in;
    width: auto;
    flex-shrink: 0;
  }
  .top-center {
    text-align: center;
    flex: 1;
    padding: 0 0.2in;
  }
  .top-qr {
    text-align: center;
    flex-shrink: 0;
  }
  .qr-code {
    width: 0.95in;
    height: 0.95in;
    border: 2px solid #ffffff;
    border-radius: 4px;
  }
  .qr-text {
    font-family: 'Poppins', Arial, sans-serif;
    font-size: 7pt;
    color: #1a2744;
    margin: 2px 0 0;
    line-height: 1.3;
    font-weight: 500;
  }

  .headline {
    font-family: 'Libre Baskerville', Georgia, serif;
    color: #1a2744;
    font-size: 28pt;
    margin: 0 0 0.02in;
    font-weight: 700;
    line-height: 1.2;
  }
  .subheadline {
    font-family: 'Poppins', Arial, sans-serif;
    color: #C9A9A6;
    font-size: 11pt;
    margin: 0;
    font-weight: 500;
  }

  /* ── Table ── */
  .signup-table {
    width: calc(8.5in - 0.7in);
    margin: 0.15in auto 0;
    border-collapse: collapse;
    font-family: 'Poppins', Arial, sans-serif;
    flex: 1;
  }
  .signup-table th {
    background: #1a2744;
    color: #F6F1EB;
    font-size: 9pt;
    font-weight: 600;
    text-align: left;
    padding: 5px 10px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .signup-table th:first-child { border-radius: 4px 0 0 0; }
  .signup-table th:last-child  { border-radius: 0 4px 0 0; }
  .signup-table td {
    border-bottom: 1px solid #e0dcd7;
    padding: 0 10px;
    font-size: 10pt;
  }
  .signup-table tbody {
    height: 100%;
  }
  .signup-table tbody tr {
    height: calc((11in - 2in - 0.85in - 0.15in - 22px) / 20);
  }
  .signup-table tr.alt td {
    background: #f7f5f2;
  }
  .signup-table th:nth-child(1),
  .signup-table td:nth-child(1) { width: 34%; }
  .signup-table th:nth-child(2),
  .signup-table td:nth-child(2) { width: 26%; }
  .signup-table th:nth-child(3),
  .signup-table td:nth-child(3) { width: 40%; }

  /* ── Bottom band ── */
  .bottom-band {
    flex-shrink: 0;
    height: 0.85in;
    background: linear-gradient(0deg, #A1B5C8 0%, #A1B5C8 45%, rgba(161,181,200,0) 100%);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 0.2in;
  }
  .footer-text {
    font-family: 'Poppins', Arial, sans-serif;
    font-size: 10pt;
    color: #1a2744;
    margin: 0;
    font-weight: 500;
    letter-spacing: 0.3px;
  }

  /* ── Print ── */
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
      height: 100vh;
      margin: 0;
    }
  }

  @media screen {
    body { background: #ddd; }
    .signup-sheet {
      margin: 20px auto;
      box-shadow: 0 2px 20px rgba(0,0,0,0.15);
    }
  }
`
