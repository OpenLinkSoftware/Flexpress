import { Col, Container, Navbar, Row } from 'react-bootstrap';
import { LdFlexClient } from './LdFlexClient'

import ldFlexLogo from './ldflex.png'
import './App.css';

function App() {

  const appMetaData = () => {
    const ldJsonObj = {
      "@context": {
        "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
        "schema": "http://schema.org/",
        "skos": "http://www.w3.org/2004/02/skos/core#"
      },
      "@id": "#this",
      "@type": "schema:SoftwareApplication",
      "schema:description": "Provides a testbed for exercising LDflex.",
      "schema:name": "Flexpress",
      "skos:altLabel": "Flexpress",
      "schema:relatedLink": {
        "@id": "https://github.com/OpenLinkSoftware/Flexpress/tree/develop"
      }
    };

    return (
      <script type="application/ld+json">
        {JSON.stringify(ldJsonObj)}
      </script>
    )
  };

  return (
    <>
      <Navbar className="navbar">
        <Navbar.Brand className="navbarBrand" href="">
          <img src={ldFlexLogo} height="40" alt="logo" />
        &nbsp;&nbsp;
        Flexpress : An LDflex test tool</Navbar.Brand>
      </Navbar>

      <Container className="appContainer" >
        <Row>
          <Col>
            <LdFlexClient pageUrl={document.URL} />
          </Col>
        </Row>
      </Container>
      {appMetaData()}
    </>
  );
}

export default App;
