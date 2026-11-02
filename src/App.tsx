import { createSampleData } from '../sample-data/sample'
import { localToday } from './engine/dates'
import { summarizeProgress } from './engine/progress'

const data = createSampleData(localToday())

function App() {
  const orders = [...data.orders].sort((a, b) => a.due.localeCompare(b.due))

  return (
    <main>
      <h1>サキヨミ</h1>
      <table>
        <thead>
          <tr>
            <th>注番</th>
            <th>型番</th>
            <th>数量</th>
            <th>納期</th>
            <th>工程全体</th>
            <th>仕掛</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const summary = summarizeProgress([order], data.lots, data.routes[order.partNumber])
            return (
              <tr key={order.id}>
                <td>{order.id}</td>
                <td>{order.partNumber}</td>
                <td>{order.quantity}</td>
                <td>{order.due}</td>
                <td>{Math.round(summary.ratio * 100)}%</td>
                <td>
                  {summary.wip}個/{summary.wipLots.length}Lot
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </main>
  )
}

export default App
