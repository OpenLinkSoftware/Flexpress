import React, { useState, useEffect, useLayoutEffect } from 'react';
import { Button, Form, Row, Col } from 'react-bootstrap';
import JSONTree from 'react-json-tree';
// ReactJson (npm react-json-view) provides a possible alternative control to JSONTree

import loaderGif from './loader-white.gif';

const { PathFactory } = require('ldflex');
const { namedNode } = require('@rdfjs/data-model');
const { default: ComunicaEngine } = require('@ldflex/comunica');

const defaultContext = `
{
  "@context": {
    "@vocab": "http://xmlns.com/foaf/0.1/",
    "friends": "knows",
    "label": "http://www.w3.org/2000/01/rdf-schema#label"
  }
}
`.trim();

// LDflex query context
let gLdfQryCtx = {
  queryEngine: null,
  pathFactory: null,
  subjectPath: null
};

// Query context states
const QC_STALE_SOURCE_CHANGED = 4;
const QC_STALE_CONTEXT_CHANGED = 2;
const QC_STALE_SUBJECT_CHANGED = 1;
const QC_VALID = 0;

// Subject URIs of the data source URI
let grSubjects = [];

// Property URIs of the current subject URI
let grSubjectProperties = [];

const defaultSource = 'https://ruben.verborgh.org/profile/';

// dataPathPresets and its accompanying select control are a stopgap until 
// data paths can be built interactively in the UI. 
//
// This requires that the available properties on the current subject node be known.
// This in turn requires that we enumerate and display the subject node properties
// with a facility to descend to a child node by selecting a subject property and then
// displaying the properties of this child node, from which one could be selected.
// By repeating this process, a multipart data path could be entered interactively,
// before being evaluated and the resulting generated query executed.
const dataPathPresets = [
  '.interest.label',
  '.interest',
  '.name',
];

const defaultLdfDataPath = dataPathPresets[0];

const outputFormats = [
  { label: "Tree", value: "fmt_tree" },
  { label: "JSON (Compact)", value: "fmt_json" },
  { label: "JSON (Formatted)", value: "fmt_json_formatted" },
];

const defaultOutputFormat = "fmt_json_formatted"

// ------------------------------------------------------------------

export function LdFlexClient(props) {

  const { qsSource, qsQuery, qsContext, qsOutputFormat } = getQueryStringParams(props.pageUrl);

  // pageUrl: The URL of the page displaying this React component.
  const pageUrl = new URL(props.pageUrl);

  // ldfQryCtxStale:
  // A flag indicating whether the LDflex query execution context is valid.
  // The query execution context comprises:
  // - a query engine (initialized with the source RDF resource).
  // - a PathFactory (initialized with the query engine and the current JSON-LD context).
  // - an LDflex path starting at the current subject node.
  // Once a query execution context has been created, a change to source,
  // JSON-LD context or subject node renders the query execution
  // context invalid and requires a new execution context to be created.
  const [ldfQryCtxStale, setLdfQryCtxStale] = useState(QC_STALE_SOURCE_CHANGED);

  // source: The RDF resource providing the data to be queried by LDflex.
  const [source, setSource] = useState(qsSource ? qsSource : defaultSource);

  // ldfSubject:
  // The selected subject in the subjects select control.
  // The selected subject sets the current subject URI / LDflex path entry point.
  const [ldfSubject, setLdfSubject] = useState(null);

  // ldfProperty:
  // The selected subject property in the properties select control.
  // TO DO: Need to provide a UI to help the user to derive an ldfDataPath from a property URI. 
  const [ldfProperty, setLdfProperty] = useState(null);

  // context: The JSON-LD context for resolving properties.
  const [context, setContext] = useState(qsContext ? qsContext : defaultContext);

  // ldfDataPath: An LDflex string expression.
  //
  // This is transformed (resolved) into an actual LDflex path.
  // The LDflex path is a JavaScript expression which is evaluated, resulting in a query
  // returning the requesting data.
  const [ldfDataPath, setLdfDataPath] = useState(defaultLdfDataPath);

  const [queryResult, setQueryResult] = useState(null);
  const [status, setStatus] = useState(null);
  const [outputFormat, setOutputFormat] = useState(qsOutputFormat ? qsOutputFormat : defaultOutputFormat);
  const [queryPermalink, setQueryPermalink] = useState(props.pageUrl);

  const [responsePending, setResponsePending] = useState(false);

  const refreshLdfQryCtxEngine = () => {
    // Precondition:
    // source should have been validated beforehand by caller.
    if (ldfQryCtxStale && QC_STALE_SOURCE_CHANGED) {
      gLdfQryCtx.queryEngine = new ComunicaEngine(source);
      setLdfQryCtxStale(ldfQryCtxStale ^ QC_STALE_SOURCE_CHANGED);
    }
  }

  const refreshLdfQryCtx = () => {
    // Precondition:
    // source, context, ldfSubject should all have been validated beforehand by caller.

    // queryEngine: f(source)
    // pathFactory: f(contextObj, queryEngine)
    // subjectPath: f(pathFactory, ldfSubject)
    // i.e.
    // queryEngine need only change if source changes.
    // pathFactory need only change if context or queryEngine has changed.
    // subjectPath need only change if pathFactory or ldfSubject has changed.

    if (ldfQryCtxStale && QC_STALE_SOURCE_CHANGED) {
      gLdfQryCtx.queryEngine = new ComunicaEngine(source);
    }

    if (ldfQryCtxStale && (QC_STALE_SOURCE_CHANGED | QC_STALE_CONTEXT_CHANGED)) {
      // PathFactory(settings, data) creates paths with default settings.
      // The settings and data args are both optional. 
      // settings provides defaults for data if data isn't supplied.
      // The default settings provided to the constructor are used when creating a path
      // but will be overridden by any settings supplied to PathFactory.create().
      let contextObj = JSON.parse(context);
      gLdfQryCtx.pathFactory = new PathFactory({ context: contextObj, queryEngine: gLdfQryCtx.queryEngine });
    }

    if (ldfQryCtxStale && (QC_STALE_SOURCE_CHANGED | QC_STALE_CONTEXT_CHANGED | QC_STALE_SUBJECT_CHANGED)) {
      // Create a new LDflex path starting from the given subject.
      gLdfQryCtx.subjectPath = gLdfQryCtx.pathFactory.create({ subject: namedNode(ldfSubject) });
    }

    setLdfQryCtxStale(QC_VALID);
  }

  // Executes the query described by the LDflex expression contained in the form.
  const execQuery = async () => {
    let contextObj;

    clearQueryResultAndStatus();

    // Validate data source URI
    try {
      validateSource();
    }
    catch (ex) {
      setStatus(ex.message);
      return;
    }

    // Validate Subject URI
    try {
      if (!ldfSubject || !ldfSubject.trim())
        throw new Error('No subject selected.');
    }
    catch (ex) {
      setStatus('Invalid subject URI: ' + ex.message);
      return;
    }

    // Validate JSON-LD context
    try {
      if (!context || !context.trim())
        throw new Error('Empty JSON-LD context');
      JSON.parse(context);
    }
    catch (ex) {
      setStatus('Invalid context: ' + ex.toString());
      return;
    }

    // Validate ldfDataPath
    try {
      if (!ldfDataPath || !ldfDataPath.trim())
        throw new Error('Data path not set');
    }
    catch (ex) {
      setStatus('Invalid LDflex data path: ' + ex.toString());
      return;
    }

    try {
      if (ldfQryCtxStale)
        refreshLdfQryCtx();

      let resolvedDataPath = gLdfQryCtx.subjectPath.resolve(ldfDataPath);
      // resolvedDataPath = subjectPath[ldfDataPath]; // also works
      // e.g.
      // subjectPath.resolve('.interest.label') or
      // subjectPath['interest']['label']

      // FIX ME 
      // We don't know whether resolvedDataPath will return a single value or an iterable when evaluated.
      // 'for await...of' doesn't work with values which are not async iterables.
      // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of
      //
      // With dataPaths which return a single value, the 'for await...of' loop is entered twice.
      // As a workaround the returned data is held in a Set to remove duplicate values.
      //
      // LDflex needs the facility to return a single value as an async iterable.

      let data = new Set();
      // setResponsePending(true); // Not required. Response from client-side query engine is very quick.
      for await (const val of resolvedDataPath) {
        // val is not a simple value, it's a Proxy instance
        data.add(val.toString());
      }

      setQueryResult([...data]);
      return;
    }
    catch (ex) {
      setStatus('Query execution failed: ' + ex.toString());
      return;
    }
    finally {
      setResponsePending(false);
    }
  }

  const validateSource = () => {
    try {
      if (!source || !source.trim())
        throw new Error('Empty string');
      let src = source.trim();
      let parsedSourceUrl = new URL(src); // Will throw exception if not a valid URL
      if (!parsedSourceUrl || parsedSourceUrl.origin === 'null')
        throw new Error('URL parsing error');
      // TO DO:Catch source URI which doesn't resolve
      return src;
    }
    catch (ex) {
      throw new Error('Invalid source URL: ' + ex.message);
    }
  }

  const getSourceSubjects = async () => {
    clearQueryResultAndStatus();

    // FIX ME: Bug in LDflex library:
    // The returned subjects include some which aren't immediate children of the source document.
    grSubjects = [];

    try {
      let src = validateSource();

      if (ldfQryCtxStale)
        refreshLdfQryCtxEngine();

      // We don't require a context for this PathFactory instance as
      // we're retrieving subjects, not executing an LDflex query.
      // context may not be set at this point.
      let pathFactory = new PathFactory({ queryEngine: gLdfQryCtx.queryEngine });
      let srcPath = pathFactory.create({ subject: namedNode(src) });
      // Note: The subjects() method is only available on a path instance.
      // This is not mentioned in the LDflex README/documentation.
      setResponsePending(true);
      for await (const subject of srcPath.subjects) {
        let subjectUri = subject.toString();
        // Filter out blank nodes
        if (subjectUri.startsWith('http'))
          grSubjects.push(subjectUri);
      }

      //  TO DO: Sort grSubjects
      if (grSubjects.length)
        setLdfSubject(grSubjects[0]);
    }
    catch (ex) {
      setStatus(ex.message);
      setLdfQryCtxStale(QC_STALE_SOURCE_CHANGED); // i.e. source is invalid
      setLdfSubject(null);
    }
    finally {
      setResponsePending(false);
    }
  }

  const getSubjectProperties = async () => {
    // FIX ME: Bug in LDflex library:
    // The returned properties can include some belonging not to the 
    // given subject but to another subject in the source document.

    grSubjectProperties = [];

    try {
      if (!ldfSubject || !ldfSubject.trim())
        throw new Error('Error: No subject selected.');

      // queryEngine should be valid if ldfSubject is valid.
      // This shouldn't happen.
      if (!gLdfQryCtx.queryEngine)
        throw new Error('Error: Query engine not instantiated.');

      // We don't require a context for this PathFactory instance as
      // we're retrieving properties, not executing an LDflex query.
      // context may not be set at this point.
      let pathFactory = new PathFactory({ queryEngine: gLdfQryCtx.queryEngine });
      // Note: The properties() method is only available on a path instance.
      // This is not mentioned in the LDflex README/documentation.
      let subjectPath = pathFactory.create({ subject: namedNode(ldfSubject) });
      setResponsePending(true);
      for await (const property of subjectPath.properties) {
        let propertyUri = property.toString();
        grSubjectProperties.push(propertyUri);
      }

      //  TO DO: Sort grSubjectProperties
      if (grSubjectProperties.length)
        setLdfProperty(grSubjectProperties[0]);
    }
    catch (ex) {
      setStatus(ex.message);
      setLdfProperty(null);
    }
    finally {
      setResponsePending(false);
    }
  }

  const sourceChangeHandler = event => {
    clearQueryResultAndStatus();
    clearLdfSubject();
    setSource(event.target.value);
    setLdfQryCtxStale(QC_STALE_SOURCE_CHANGED);
  }

  const contextChangeHandler = event => {
    clearQueryResultAndStatus();
    setContext(event.target.value);
    setLdfQryCtxStale(QC_STALE_CONTEXT_CHANGED);
  }

  const outputFormatChangeHandler = event => {
    setOutputFormat(event.target.value);
  }

  const dataPathChangeHandler = event => {
    clearQueryResultAndStatus();
    setLdfDataPath(event.target.value);
  }

  const lstSubjectChangeHandler = event => {
    clearQueryResultAndStatus();
    setLdfSubject(event.target.value);
    setLdfQryCtxStale(QC_STALE_SUBJECT_CHANGED);
  }

  const lstPropertyChangeHandler = event => {
    setLdfProperty(event.target.value);
    clearQueryResultAndStatus();
    // ldfProperty is independent of ldfDataPath at the moment:
    // setLdfQryCtxStale(QC_STALE_xxx_CHANGED); 
  }

  const clearQueryResultAndStatus = () => {
    setQueryResult(null);
    setStatus(null);
  }

  const clearLdfSubject = () => {
    setLdfSubject(null);
    setLdfProperty(null);
    grSubjects = [];
    grSubjectProperties = [];
  }

  const resetDefaults = () => {
    clearQueryResultAndStatus();
    clearLdfSubject();
    setSource(defaultSource);
    setContext(defaultContext);
    setLdfDataPath(defaultLdfDataPath);
    setOutputFormat(defaultOutputFormat);
    setLdfQryCtxStale(QC_STALE_SOURCE_CHANGED);

    // Strip off any query string provided initially,
    // i.e. any query permalink which was executed on page load
    window.history.pushState({}, document.title, pageUrl.pathname);
  }

  const renderedQueryResult = (format) => {
    let res;
    switch (format) {
      case "fmt_tree":
        res = <JSONTree data={queryResult} theme={{ scheme: 'marakesh' }} />;
        break;
      case "fmt_json":
        res = <p className="qryRsltJsonText">{JSON.stringify(queryResult)}</p>;
        break;
      case "fmt_json_formatted":
      default:
        res = <pre className="qryRsltJsonText">{JSON.stringify(queryResult, null, 2)}</pre>;
        break;
    }

    return res;
  }

  const queryResultMetaData = () => {
    if (queryResult) {
      let contextObj = context.trim() ? JSON.parse(context) : null;
      let metadata = contextObj ? contextObj : {};

      metadata.queryResult = queryResult;

      return (
        <script type="application/ld+json">
          {JSON.stringify(metadata)}
        </script>
      );
    }
    else {
      return null;
    }
  }

  function getQueryStringParams(pageUrl) {
    try {
      let params, qsSource, qsQuery, qsContext, qsOutputFormat;

      params = new URL(pageUrl).searchParams;
      qsSource = params.has('source') ? decodeURIComponent(params.get('source')).trim() : null;
      qsQuery = params.has('query') ? decodeURIComponent(params.get('query')).trim() : null;
      qsContext = params.has('context') ? decodeURIComponent(params.get('context')).trim() : null;
      qsOutputFormat = params.has('format') ? decodeURIComponent(params.get('format')).trim() : null;
      return { qsSource, qsQuery, qsContext, qsOutputFormat };
    }
    catch (e) {
      return {};
    }
  }

  function makeQueryPermalink() {
    let validQuery;
    let tContext = context.trim();
    let tSource = source.trim();

    // Allow bookmarks to queries which may not execute successfully.
    validQuery = tContext && tSource;

    // Only allow bookmarks to queries which have executed successfully.
    // validQuery = tContext && tSource && queryResult;

    let permalink = new URL(props.pageUrl);
    permalink.search = '';

    if (validQuery) {
      permalink.search += `source=${encodeURIComponent(tSource)}`;
      permalink.search += `&format=${encodeURIComponent(outputFormat)}`;
      permalink.search += `&context=${encodeURIComponent(tContext)}`;
    }
    return permalink.href;
  }

  // If the page URL specifies a query then execute it on page load.
  // Note: useEffect(..., []) is equivalent to componentDidMount
  /*
  useEffect(() => {
    if (qsSource && qsQuery && qsContext && !queryResult)
      execQuery();
    // eslint-disable-next-line
  }, []);
  */

  // Only generate a query permalink once the states on which it depends
  // have been updated (asynchronously). To ensure this is the case, we 
  // use useLayoutEffect.
  /* FIX ME
  useLayoutEffect(() => setQueryPermalink(makeQueryPermalink()),
    // queryPermalink and makeQueryPermalink purposely omitted from the dependency array.
    [queryResult, query, context, source, outputFormat]); 
  */


  return (
    <>
      <Form>
        <Form.Group>
          <div style={{ display: "flex" }}>
            <Form.Label>Data source URI:</Form.Label>
            <div style={{ flex: "1", textAlign: "right" }}>
              <img src={loaderGif} className="loaderGif" style={{ visibility: (responsePending ? "visible" : "hidden") }} />
            </div>
          </div>

          <Form.Control className="inputCntrl1" value={source} onChange={sourceChangeHandler} />

          <div style={{ display: "flex", marginBottom: "5px" }}>
            <Button onClick={() => getSourceSubjects()} style={{ fontSize: "90%", width: "20%" }}>Subjects</Button>
            <span>&nbsp;</span>
            <Form.Control as="select" value={ldfSubject} onChange={lstSubjectChangeHandler} style={{ fontSize: "90%" }}>
              {grSubjects.map(subject => <option value={subject}>{subject}</option>)}
            </Form.Control>
          </div>

          <div style={{ display: "flex" }}>
            <Button onClick={() => getSubjectProperties()} style={{ fontSize: "90%", width: "20%" }}>Subject Properties</Button>
            <span>&nbsp;</span>
            <Form.Control as="select" value={ldfProperty} onChange={lstPropertyChangeHandler} style={{ fontSize: "90%" }}>
              {grSubjectProperties.map(property => <option value={property}>{property}</option>)}
            </Form.Control>
          </div>
        </Form.Group>

        <div style={{ display: "flex" }}>

          <Form.Group style={{ flex: "1" }}>
            <Form.Label>Context:</Form.Label>
            <Form.Control className="inputCntrl1 inputTextArea" as="textarea" rows={7}
              value={context} onChange={contextChangeHandler}
            />
          </Form.Group>

          <div>&nbsp;</div>

          {/*
          <Form.Group style={{ flex: "1" }}>
            <Form.Label>LDflex data path:</Form.Label>
            <Form.Control className="inputCntrl1 inputTextArea" as="textarea" rows={7}
              value={ldfDataPath} 
            />
          </Form.Group>
          */}

          {/* Stopgap select control to be replaced by above textarea for entering an LDflex data path */}
          <Form.Group style={{ flex: "1" }}>
            <Form.Label style={{ paddingRight: "10px" }}>LDflex data path:</Form.Label>
            <Form.Control as="select" value={ldfDataPath} onChange={dataPathChangeHandler} style={{ fontSize: "90%" }}>
              {dataPathPresets.map((strDataPath) => (
                <option value={strDataPath}>{strDataPath}</option>
              ))}
            </Form.Control>
          </Form.Group>
        </div>
        <Button onClick={() => execQuery()}>Execute</Button> &nbsp;
        <Button onClick={() => clearQueryResultAndStatus()}>Clear</Button> &nbsp;
        <Button onClick={() => resetDefaults()}>Defaults</Button>&nbsp;
        <Row style={{ marginBottom: "5px" }}>
          <Col>
            <Form.Group>
              <Form.Label style={{ position: "relative", top: "5px" }}>Query result:</Form.Label>
            </Form.Group>
          </Col>
          <Col>
            <div className="form-inline">
              <Form.Group className="d-flex justify-content-end" style={{ width: "100%" }}>
                <Form.Label style={{ paddingRight: "10px" }}>Output format:</Form.Label>
                <Form.Control as="select" value={outputFormat} onChange={outputFormatChangeHandler} style={{ fontSize: "90%" }}>
                  {outputFormats.map((format) => (
                    <option value={format.value}>{format.label}</option>
                  ))}
                </Form.Control>
              </Form.Group>
            </div>
          </Col>
        </Row>
        <Form.Group>
          <div className="qryRsltContainer">
            {
              queryResult ?
                renderedQueryResult(outputFormat) :
                <div className="errorTxtContainer" />
            }
            {
              status ? <p className="errorTxt">{status}</p> : ''
            }
          </div>
        </Form.Group>
      </Form>
    </>
  );
}
