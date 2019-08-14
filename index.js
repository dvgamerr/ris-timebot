const args = require('args')
const moment = require('moment')
const rp = require('request-promise')
const lookup = require('./lib/lookup')
const debug = require('./lib/debug')
const request = require('./lib/request')
const pkg = require('./package.json')

const notifyMessage = (type = 'error', message, detail) => rp({
  url: `http://posgateway.cmg.co.th:3000/flex/${type}/C06c9ae19898c9841c930b746ec0855c3`,
  method: 'PUT',
  body: { app: `RIS-Timebot v${pkg.version}`, message: message.substr(0, 250), detail: detail.substr(0, 250) },
  json: true
})

const notifyLog = (text) => rp({
  url: `http://posgateway.cmg.co.th:3000/notify/health-check/slog`,
  body: { message: `*RIS-Timebot v${pkg.version}*\n${text}` },
  json: true
})

const getUserLogin = async (User, Password) => {
  let res = await request('GetUserLogin', { User, Password }, 'Login.aspx')
  if (!res.d) throw new Error(`Timereport GetUserLogin is undefined.`)
  if (res.d !== 'Success') throw new Error(`Can't Login.`)
  return res.d === 'Success'
}

const getPeriod = async () => {
  let res = await request('GetPeriod')
  if (!res.d) throw new Error('Timereport GetPeriod is undefined.')
  return res.d.match(/value='(.+?)'/ig).map(period => /value='(.+?)'/ig.exec(period)[1])
}

const getUser = async (User) => {
  let res = await request('GetUser', { User })
  if (!res.d) throw new Error('Timereport GetUser is undefined.')
  let [ , name, depart, approver ] = /:(.*?)&.*?:(.*?)&.*?:(.*)/ig.exec(res.d) || []
  return {
    name: name.trim(),
    depart: depart.trim(),
    approver: approver.trim()
  }
}

const getFirstTimesheetID = async (User, Period) => {
  let res = await request('GetFirstTimesheetID', { User, Period })
  if (!res.d) throw new Error('Timereport getFirstTimesheetID is undefined.')
  return res.d
}

const getStatusTimesheet = async (TimeSheetID) => {
  let res = await request('GetStatusTimesheet', { TimeSheetID })
  if (!res.d) throw new Error('Timereport GetStatusTimesheet is undefined.')

  const status = { '11_': 'OK', '12_': 'Submitted', '14_': 'Approved' }
  return { id: res.d, state: status[res.d] }
}

const getSearchJobMaster = async (User, TimeSheetID) => {
  let res = await request('GetSearchJobMaster', { User, TimeSheetID })
  if (!res.d) throw new Error('Timereport GetSearchJobMaster is undefined.')
  return (res.d.match(/<option.*?option>/ig) || []).map(period => {
    let [ , value, label ] = /value='(.+?)'.*?>(.+?)</ig.exec(period)
    return { value, label }
  })
}

const getTJobInTimeSheet = async (TimeSheetID) => {
  let res = await request('GetTJobInTimeSheet', { TimeSheetID })
  // if (!res.d) throw new Error('Timereport GetTJobInTimeSheet is undefined.')
  return (res.d.match(/<option.*?option>/ig) || []).map(period => {
    let [ , value, label ] = /value='(.+?)'.*?>(.+?)</ig.exec(period)
    return { value, label }
  })
}
const getTimeSheetData = async (TimeSheetID, PeriodID, Status, User, OptionID) => {
  let res = await request('GetTimeSheetData', { TimeSheetID, PeriodID, Status, User })
  if (!res.d) throw new Error('Timereport GetTimeSheetData is undefined.')
  let data = res.d.match(/<td.*?td>/ig).filter(opt => {
    let regex = new RegExp(`<td.class=''.*?R_${OptionID}`, 'ig')
    return regex.test(opt)
  }).map(opt => {
    let [ , value, colLabel, rowLabel, colValue, rowValue ] = /value='(.*?)'.*?CalculateAndSaveData\("(.*?)".*?"(.*?)".*?"(.*?)".*?"(.*?)"/ig.exec(opt) || []
    return { val: value, col: colValue, row: rowValue, colLabel, rowLabel }
  })
  if (!data || data.length === 0) throw new Error('Timereport GetTimeSheetData column CalculateAndSaveData is undefined.')
  return data
}

const GetTimeSheetDataSum = async (TimeSheetID, PeriodID) => {
  let res = await request('GetTimeSheetDataSum', { TimeSheetID, PeriodID })
  if (!res.d) throw new Error('Timereport GetTimeSheetDataSum is undefined.')
  let data = res.d.match(/SumTotalTime.*?>.*?</ig).map(opt => {
    let [ , col ] = />(.*?)</ig.exec(opt) || []
    return parseInt(col)
  })
  if (!data || data.length === 0) throw new Error('Timereport GetTimeSheetData column CalculateAndSaveData is undefined.')
  return data
}

const insertJobTimeSheetDetail = async (TimeSheetID, ProjectID, PeriodID, Status, User, RowIndex) => {
  let res = await request('InsertJobTimeSheetDetail', { TimeSheetID, ProjectID, PeriodID, Status, User, RowIndex })
  if (!res.d) throw new Error('Timereport InsertJobTimeSheetDetail is undefined.')
  return res.d
}

const updateTimeSheetLineTrans = async (Value, LindID, Column) => {
  let res = await request('UpdateTimeSheetLineTrans', { Value, LindID, Column })
  if (!res.d) throw new Error('Timereport UpdateTimeSheetLineTrans is undefined.')
  return res.d === 'Success'
}

const UpdateTimeSheetSubmittedDate = async (TimeSheetID, User) => {
  return request('UpdateTimeSheetSubmittedDate', { TimeSheetID, User })
}

const SendMailSubmitTime = async (TimeSheetID, User, Period) => {
  return request('SendMailSubmitTime', { TimeSheetID, User, Period })
}

args.option('employee', 'timereport username', 0)
args.option('password', 'timereport username', 0)
args.option('job', 'timesheet job id', '')
args.option('hour', 'hour append to job', 8)
args.option('submit', 'sumbit timesheet', false)
const { employee, password, job, hour, submit } = args.parse(process.argv)

let messageLog = ''
lookup('rshdtimessrv01').then(async dns => {
  if (employee === 0) throw new Error('Please set employee.')
  if (password === 0) throw new Error('Please set password.')
  if (job === '') throw new Error('Please set job id.')
  if (hour < 1 || hour > 8) throw new Error('Please set hour range 1-8.')

  debug.log(`Server 'rshdtimessrv01' Login IPv${dns.family}: ${dns.address}`).end()
  debug.log(`GetUserLogin: `)
  await getUserLogin(employee, password)
  let user = await getUser(employee)
  debug.append('SUCCESS').end('start')
  debug.log(`Welcome: ${user.name} Department: ${user.depart}`).end()
  debug.log(`Approver: ${user.approver}`).end('info')
  debug.log(`GetPeriod checking: `)
  messageLog = `Daily cheking timesheet **${user.name}**.`
  let period = await getPeriod()
  for (const option of period) {
    let date = moment(option)
    if (date > moment().startOf('day')) continue

    debug.append(option)
    let id = await getFirstTimesheetID(employee, option)
    let status = await getStatusTimesheet(id)
    if (status.state === 'OK') {
      let master = await getSearchJobMaster(employee, id)
      debug.end()
      debug.log(`SearchJobMaster: ${job} `)
      let getMaster = master[master.map(o => o.value).indexOf(job)]
      let table = await getTJobInTimeSheet(id)
      if (getMaster) {
        debug.append(`- ${getMaster.label}`).end()
        // insertJobTimeSheetDetail
        let bugRowId = 2
        await insertJobTimeSheetDetail(id, job, option, status.id, employee, table.length + 1 + bugRowId)
      } else {
        let getUser = table[table.map(o => o.value).indexOf(job)]
        if (!getUser) {
          debug.append(`is ${`not found`} in master jobs or user job.`).end()
          throw new Error('JobID worng.')
        }
        debug.append(`- ${getUser.label}`).end()
      }
      // updateTimeSheetTable
      debug.log(`${'System all green'}, Automation is begin...`).end()
      // get data table
      let sum = await GetTimeSheetDataSum(id, option)
      let input = await getTimeSheetData(id, option, status.id, employee, job)
      for (const data of input) {
        let add = hour - sum[data.col - 1]
        if (data.val === '' && add > 0) {
          let res = await updateTimeSheetLineTrans(add, data.row, data.col)
          if (!res) {
            debug.log(`Automation timesheet update ${'fail'}.`).end()
            messageLog += `<br>Unapproved timesheet update fail.`
            await notifyLog(messageLog)

            throw new Error(`at Col:${data.colLabel} Row:${data.rowLabel}`)
          }
        }
      }

      // Approved call api.
      debug.log(`Automation timesheet update ${'successful'}.`).end('success')
      if (submit) {
        await UpdateTimeSheetSubmittedDate(id, employee)
        debug.log(`- Timesheet submit ${'successful'}.`).end('info')
        await SendMailSubmitTime(id, employee, option)
        debug.log(`- Timesheet email ${'successful'}.`).end('info')
        messageLog += `<br>Approve timesheet update successful.`
        await notifyLog(messageLog)
      }
    } else {
      let res = await notifyLog(messageLog)
      debug.append(` >> ${status.state}.`).end('info')
      if (res.error) throw new Error(res.error)
    }
    break
  }
}).catch(ex => {
  notifyMessage('error', ex.message, ex.stack)
  debug.end().log(`CATCH >> ${'FAIL'} (${ex.message})`).end('error')
  debug.append('  ' + ex.stack)
})
