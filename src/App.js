import { useState, useEffect, useMemo, useReducer } from 'react'
import { Container, Navbar } from 'react-bootstrap'

import FloatingActionButton from './FloatingActionButton'

import Toolbar from './Toolbar'
import Calendar from './Calendar'
import { getInitialState, setQueryParam, unsetQueryParam, fetchJsObject } from './utils'

import { ApplicationInsights } from '@microsoft/applicationinsights-web'
import { ReactPlugin, withAITracking } from '@microsoft/applicationinsights-react-js'

import { ThemeConfig } from 'bootstrap-darkmode';

const isDevelopment = process.env.NODE_ENV === 'development'
const API = `${isDevelopment ? 'localhost:7071' : window.location.host}/api`

let App = () => {
  // Dark mode
  const [darkMode, setDarkMode] = useState(false)


  const themeConfig = useMemo(() => {
    const tc = new ThemeConfig();

    tc.loadTheme = () => {
      const theme = localStorage.getItem('darkMode')
      if (theme === 'true') {
        setDarkMode(true);
        return 'dark';
      }
      return 'light';
    }

    tc.saveTheme = (theme) => {
      setDarkMode(theme === 'dark');
      localStorage.setItem('darkMode', theme === 'dark' ? 'true' : 'false');
    }

    return tc;
  }, [])

  useEffect(() => {
    themeConfig.initTheme();
  }, [themeConfig])

  function toggleDarkMode() {
    const theme = themeConfig.getTheme();
    themeConfig.setTheme(theme === 'dark' ? 'light' : 'dark');
  }

  // Timezone string, like "Australia/Sydney"
  const [timeZone, setTimeZone] = useState(localStorage.timeZone
    // If localStorage is empty, use browser's timezone and handle UTC special case
    || Intl.DateTimeFormat()?.resolvedOptions()?.timeZone.replace(/^UTC$/, 'Etc/GMT')
    || 'Australia/Canberra' // Default to Canberra if API is missing (pre-2018 browsers)
  )
  useEffect(() => localStorage.timeZone = timeZone, [timeZone])

  const [y, s, m, h] = getInitialState()

  const [year, setYear] = useState(y)
  useEffect(() => setQueryParam('y', year), [year])

  // Current session (eg "S1" is semester 1)
  const [session, setSession] = useState(s)
  useEffect(() => setQueryParam('s', session), [session])

  // List of all supported sessions
  const [sessions, setSessions] = useState([])
  useEffect(() => fetchJsObject(`${window.location.protocol}//${API}/sessions`, setSessions), [sessions])

  // Timetable data as a JS object
  const [timetableData, setTimetableData] = useState({})
  useEffect(() => fetchJsObject(`/timetable_${year}_${session}.json`, setTimetableData), [year, session])

  // Modules (courses) are in an object like { COMP1130: { title: 'COMP1130 Pro...', dates: 'Displaying Dates: ...', link: "" }, ... }
  const processModule = ({ classes, id, title, ...module }) => ({ title: title.replace(/_[A-Z][1-9]/, ''), ...module })
  const [modules, setModules] = useState({})
  useEffect(() => setModules(Object.entries(timetableData).reduce((acc, [key, module]) => ({ ...acc, [key.split('_')[0]]: processModule(module) }), {})), [timetableData])

  // This needs to be a reducer to access the previous value 
  const selectedModulesReducer = (state, updatedModules) => {
    // Find no longer preset entries
    state.forEach(m => {
      // No longer present
      if (!updatedModules.includes(m)) {
        unsetQueryParam(m.id)
      }
    })
    // Find new entries
    updatedModules.forEach(m => {
      // New module
      if (!state.includes(m)) {
        setQueryParam(m.id)
      }
    })

    return updatedModules
  }

  // Selected modules are stored as an *array* of module objects as above, with
  // an additional `id` field that has the key in `modules`
  const [selectedModules, setSelectedModules] = useReducer(selectedModulesReducer, m.map(([id]) => ({ id })))

  // List of events chosen from a list of alternatives globally
  // List of lists like ['COMP1130', 'ComA', 1] (called module, groupId, occurrence)
  const getSpecOccurrences = () => m.flatMap(([module, occurrences]) => occurrences.split(',').flatMap(o => {
    // We're flatMapping so that we can return [] to do nothing and [result] to return a result
    if (!o || !selectedModules.map(({ id }) => id).includes(module)) return []
    const r = o.match(/([^0-9]*)([0-9]+)$/)
    if (!r || !r[2]) {
      console.error("Failed to find regex or second pattern in regex for input", o)
      return []
    }
    return [[module, r[1], parseInt(r[2])]]
  }))

  const changeOccurrences = (state, action) => {
    let [module, groupId, occurrence] = action.values
    switch (action.type) {
      case 'select':
        setQueryParam(module, groupId + occurrence)
        return [...state, action.values]
      case 'reset':
        setQueryParam(module, '')
        return state.filter(
          ([m, g, o]) => !(m === module && g === groupId && o === occurrence)
        )
      default:
        throw new Error()
    }
  }

  const [specifiedOccurrences, setSpecifiedOccurrences] = useReducer(changeOccurrences, getSpecOccurrences())

  const changeHidden = (state, action) => {
    switch (action.type) {
      case 'reset':
        unsetQueryParam('hide')
        return []
      case 'hide':
        // Should we have a hide url parameter
        const hide = state.map(x => x.join('_')).join(',')
        if (hide.length > 0)
          setQueryParam('hide', hide)
        else
          unsetQueryParam('hide')
        return [...state, action.values]
      default:
        throw new Error()
    }
  }
  // Events that are manually hidden with the eye icon
  const [hidden, setHidden] = useReducer(changeHidden, h)

  // Starting day of the week
  const [weekStart, setWeekStart] = useState(0);
  useEffect(() => {
    let localWeekStart = localStorage.getItem('weekStart')
    if (localWeekStart) {
      localWeekStart = parseInt(localWeekStart)
      if (localWeekStart >= 0 && localWeekStart <= 6) {
        setWeekStart(localWeekStart)
      } else {
        localStorage.removeItem('weekStart')
      }
    }
  }, []);

  // 0-indexed days of the week to hide (starting from Sunday)
  const [hiddenDays, setHiddenDays] = useState([])
  useEffect(() => {
    // use reduce to discard non-int days
    const localHiddenDays = localStorage.getItem('hiddenDays')?.split(',')
      .reduce((acc, x) => [...acc, ...([parseInt(x)] || [])], [])
    if (localHiddenDays) {
      setHiddenDays(localHiddenDays)
    }
  }, []);

  const timetableState = {
    timeZone, year, session, sessions, specifiedOccurrences, hidden, timetableData, modules, selectedModules, weekStart, darkMode,
    setTimeZone, setYear, setSession, setSessions, setSpecifiedOccurrences, setHidden, setTimetableData, setModules, setSelectedModules,
    hiddenDays,
  }

  // fluid="xxl" is only supported in Bootstrap 5
  return <Container fluid>
    <h2 className="mt-2">ANU Timetable</h2>

    <Toolbar API={API} timetableState={timetableState} />

    <Calendar timetableState={timetableState} />

    <Navbar>
      <Navbar.Text>
        Made with <span role="img" aria-label="love">💖</span> by the&nbsp;
        <a target="_blank" rel="noreferrer" href="https://cssa.club/">ANU CSSA</a>&nbsp;
        (and a <a target="_blank" rel="noreferrer" href="/contributors.html">lot of people</a>), report issues&nbsp;
        <a target="_blank" rel="noreferrer" href="https://forms.office.com/r/sZnsxtsh2F">here</a>
      </Navbar.Text>
    </Navbar>

    <FloatingActionButton {...{
      weekStart, setWeekStart,
      hiddenDays, setHiddenDays,
      darkMode, toggleDarkMode,
      hidden, setHidden
    }} />
  </Container>
}

// Analytics
if (!isDevelopment) {
  const reactPlugin = new ReactPlugin();
  const appInsights = new ApplicationInsights({
    config: {
      connectionString: process.env.REACT_APP_INSIGHTS_STRING,
      disableFetchTracking: false,
      enableCorsCorrelation: true,
      extensions: [reactPlugin]
    }
  })
  appInsights.loadAppInsights()

  App = withAITracking(reactPlugin, App)
}

export default App
