import './App.css'
import { mockEpisodes } from './features/episodes/mockEpisodes'
import { useEpisodeFilters } from './features/episodes/useEpisodeFilters'

const institutions = Array.from(
  new Set(mockEpisodes.flatMap((episode) => episode.institutions)),
).sort((left, right) => left.localeCompare(right, 'ko'))

function App() {
  const institution = useEpisodeFilters((state) => state.institution)
  const query = useEpisodeFilters((state) => state.query)
  const setInstitution = useEpisodeFilters((state) => state.setInstitution)
  const setQuery = useEpisodeFilters((state) => state.setQuery)

  const normalizedQuery = query.trim().toLocaleLowerCase('ko')
  const filteredEpisodes = mockEpisodes.filter((episode) => {
    const matchesInstitution =
      institution === 'all' || episode.institutions.includes(institution)
    const matchesQuery =
      normalizedQuery.length === 0 ||
      episode.id.toLocaleLowerCase('ko').includes(normalizedQuery) ||
      episode.institutions.some((item) =>
        item.toLocaleLowerCase('ko').includes(normalizedQuery),
      )

    return matchesInstitution && matchesQuery
  })

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="주요 메뉴">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            AR
          </span>
          <span>
            <strong>AML RADAR</strong>
            <small>중앙 분석기관</small>
          </span>
        </div>

        <nav className="sidebar-nav">
          <a href="#dashboard">중앙 분석 대시보드</a>
          <a href="#upload">거래 데이터 처리</a>
          <a className="active" href="#episodes" aria-current="page">
            Episode 목록
          </a>
          <a href="#cases">사건 조사</a>
          <a href="#graph">관계 그래프</a>
        </nav>

        <div className="sidebar-note">
          <span>현재 구현</span>
          <strong>Episode 목록 골격</strong>
          <small>나머지 메뉴는 경로만 표시함</small>
        </div>
      </aside>

      <main className="page" id="episodes">
        <header className="page-header">
          <div>
            <p className="eyebrow">EPISODE MANAGEMENT</p>
            <h1>Episode 목록</h1>
            <p className="page-description">
              여러 금융기관의 연관 거래를 묶은 Alert 단위를 조회함.
            </p>
          </div>
          <span className="mock-badge">MOCK DATA</span>
        </header>

        <section className="contract-notice" aria-label="백엔드 계약 상태">
          <span className="notice-icon" aria-hidden="true">
            i
          </span>
          <div>
            <strong>조회 API 계약 대기</strong>
            <p>
              실제 Backend에는 거래 수신 API만 있음. 상태·위험도 구간·담당자·Case
              연결 규칙은 확정 전까지 표시하지 않음.
            </p>
          </div>
        </section>

        <section className="list-panel" aria-labelledby="episode-result-title">
          <div className="filters">
            <label className="search-field">
              <span>Episode 검색</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Episode ID 또는 금융기관"
              />
            </label>

            <label className="select-field">
              <span>금융기관 필터</span>
              <select
                value={institution}
                onChange={(event) => setInstitution(event.target.value)}
              >
                <option value="all">전체 금융기관</option>
                {institutions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="result-heading">
            <div>
              <h2 id="episode-result-title">탐지된 Episode</h2>
              <p>목록 한 줄은 Episode(Alert) 하나임.</p>
            </div>
            <strong>{filteredEpisodes.length}건</strong>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Episode ID</th>
                  <th scope="col">탐지 시각</th>
                  <th scope="col">관련 금융기관</th>
                  <th scope="col" className="number-column">
                    계좌
                  </th>
                  <th scope="col" className="number-column">
                    거래
                  </th>
                  <th scope="col" className="amount-column">
                    총 거래금액
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredEpisodes.map((episode) => (
                  <tr key={episode.id}>
                    <td>
                      <strong className="episode-id">{episode.id}</strong>
                    </td>
                    <td>{episode.detectedAt}</td>
                    <td>
                      <div className="institution-list">
                        {episode.institutions.map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                    </td>
                    <td className="number-column">{episode.accountCount}</td>
                    <td className="number-column">{episode.transactionCount}</td>
                    <td className="amount-column">{episode.totalAmount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredEpisodes.length === 0 && (
            <div className="empty-state">
              <strong>조건에 맞는 Episode가 없음.</strong>
              <span>검색어 또는 금융기관 필터를 다시 확인함.</span>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
